import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { parse } from "@iarna/toml";
import {
  dataHash,
  consumerCodehash,
  nodeProvider,
  privKey1,
  sequencerProvider,
  signatureProverProvider,
  signers,
  threshold,
  vkey,
} from "./_setup";
import {
  AuthenticationStatusEnum,
  AXIOM_ACCOUNT,
  AXIOM_ACCOUNT_AUTH_INPUTS,
  AXIOM_CODEHASH,
  AXIOM_EOA,
  BlockTag,
  encodeMOfNData,
  KeystoreAccountBuilder,
  TransactionStatus,
  UpdateTransactionBuilder,
  type AccountState,
  type SponsorAuthInputs,
  type UpdateTransactionRequest,
} from "@axiom-crypto/keystore-sdk";
import { concat, decodeAbiParameters, encodeAbiParameters } from "viem";
import { sleep } from "bun";
import { green, yellow } from "./utils";

const RETRY_INTERVAL_SEC = 30;
const MAX_RETRIES = 20;

(async () => {
  const tomlContent = readFileSync("src/_accountKeystore.toml", "utf-8");
  const config = parse(tomlContent);

  const keystoreAddress = config.keystoreAddress as `0x${string}`;
  const nonce = BigInt(
    await nodeProvider.getTransactionCount(keystoreAddress, BlockTag.Latest)
  );

  // Initialize KeystoreAccount object based on whether the account is counterfactual or not.
  let keystoreAccount;
  let eoaAddrs: `0x${string}`[];
  if (nonce === 0n) {
    keystoreAccount = KeystoreAccountBuilder.initCounterfactual(
      config.salt as `0x${string}`,
      dataHash,
      vkey
    );
    eoaAddrs = signers;
  } else {
    const state: AccountState = await nodeProvider.getStateAt(
      keystoreAddress,
      BlockTag.Latest
    );

    const [, , addrs] = decodeAbiParameters(
      [
        { name: "codehash", type: "uint256" },
        { name: "threshold", type: "uint256" },
        { name: "eoaAddrs", type: "address[]" },
      ],
      ("0x" + state.data.slice(4)) as `0x${string}`
    );

    // @ts-expect-error
    eoaAddrs = addrs;

    keystoreAccount = KeystoreAccountBuilder.initWithKeystoreAddress(
      keystoreAddress,
      state.dataHash,
      vkey
    );
  }

  // Fetch how much the sequencer is charging for `feePerGas`
  const feePerGas = await sequencerProvider.gasPrice();

  const newUserData = constructNewUserData();
  const txReq: UpdateTransactionRequest = {
    nonce: nonce,
    feePerGas,
    newUserData,
    newUserVkey: vkey, // We won't alter the vkey
    userAcct: keystoreAccount,
    sponsorAcct: AXIOM_ACCOUNT,
  };

  const updateTx = UpdateTransactionBuilder.fromTransactionRequest(txReq);
  const userSig = await updateTx.sign(privKey1);

  const sponsorAuthInputs: SponsorAuthInputs = {
    sponsorAuth: AXIOM_ACCOUNT_AUTH_INPUTS,
    userAuth: {
      codeHash: consumerCodehash,
      signatures: [userSig],
      eoaAddrs,
    },
  };

  const keyData = concat([
    "0x00",
    encodeAbiParameters(
      [
        { name: "codehash", type: "bytes32" },
        { name: "threshold", type: "uint256" },
        { name: "eoaAddrs", type: "address[]" },
      ],
      [consumerCodehash, threshold, eoaAddrs]
    ),
  ]);
  const sponsorKeyData = concat([
    "0x00",
    encodeAbiParameters(
      [
        { name: "codehash", type: "bytes32" },
        { name: "threshold", type: "uint256" },
        { name: "eoaAddrs", type: "address[]" },
      ],
      [AXIOM_CODEHASH, 0n, [AXIOM_EOA]]
    ),
  ]);

  console.log(
    `Sending request to generate ZK proof to signature prover rpc...\n\t${green(
      "User Key Data (from keystore)"
    )}: ${keyData}\n\t${green(
      "User Auth Data (signatures)"
    )}: [${userSig}]\n\t${green(
      "Sponsor Key Data (from keystore)"
    )}: ${sponsorKeyData}\n\t${green(
      "Sponsor Auth Data (for private devnet, the sponsor account is chosen to require no authentication)"
    )}: []`
  );

  const requestHash =
    await signatureProverProvider.sponsorAuthenticateTransaction(
      updateTx.txBytes(),
      sponsorAuthInputs
    );

  console.log(`${yellow("\tRequest hash: ")} ${requestHash}`);
  console.log();
  console.log(
    "Waiting for sponsor authentication to complete. This typically takes ~6 minutes...\n\t(with the recent OpenVM v1.0.0-rc.1 release, this will also be ~30% shorter)"
  );

  // Write the transaction request to a file for debugging purposes
  try {
    mkdirSync("src/debug", { recursive: true });
    const txJson = JSON.stringify(
      txReq,
      (_, value) => (typeof value === "bigint" ? value.toString() : value),
      2
    );
    writeFileSync(`src/debug/${requestHash}.json`, txJson);
  } catch (err) {
    console.error("Error writing debug file", err);
  }

  // Polls the request status until it's completed
  let i = 0;
  const authenticatedTx = await (async () => {
    while (true) {
      const status =
        await signatureProverProvider.getSponsorAuthenticationStatus(
          requestHash
        );
      console.log(`\tTime elapsed: ${(i++ * RETRY_INTERVAL_SEC) / 60} minutes`);
      switch (status.status) {
        case AuthenticationStatusEnum.Pending:
          await sleep(RETRY_INTERVAL_SEC * 1000);
          continue;
        case AuthenticationStatusEnum.Failed:
          throw new Error("Transaction authentication failed");
        case AuthenticationStatusEnum.Completed:
          if (!status.authenticatedTransaction) {
            throw new Error("No authenticated transaction found");
          }
          console.log(`\t${green("Sponsor authentication completed!")}`);
          return status.authenticatedTransaction;
        default:
          throw new Error("Invalid authentication status");
      }
    }
  })();

  console.log();
  console.log("Sending transaction to keystore sequencer...");
  const txHash = await sequencerProvider.sendRawTransaction(authenticatedTx);
  console.log("\tKeystore Tx Hash:", txHash);

  console.log();
  console.log("Waiting for transaction to be finalized...");

  // Polls the transaction receipt until it's finalized
  let currentStatus = "";
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const receipt = await nodeProvider.getTransactionReceipt(txHash);

      if (currentStatus !== receipt?.status) {
        currentStatus = receipt?.status;

        switch (receipt?.status) {
          case TransactionStatus.L2Pending:
            // Access to the sequencer mem pool is currently not implemented
            break;
          case TransactionStatus.L2IncludedL1Pending:
            // Preconfirmed blocks are currently not gossiped to nodes
            break;
          case TransactionStatus.L2IncludedL1Included:
            console.log(
              `${yellow(
                "\tStatus: transaction included in block and committed to L1"
              )}`
            );
            break;
          case TransactionStatus.L2FinalizedL1Included:
            console.log(
              `\t${green(
                `Success: keystore block ${receipt?.blockNumber!} containing update transaction was finalized on L1!`
              )}\n\nCheck the previous state of the keystore account using:\ncast rpc keystore_getStateAt ${keystoreAddress} ${
                receipt?.blockNumber! - 1n
              } --rpc-url http://keystore-rpc-node.axiom.xyz | jq\n\nVerify the transaction updated the keystore account state using:\ncast rpc keystore_getStateAt ${keystoreAddress} "latest" --rpc-url http://keystore-rpc-node.axiom.xyz | jq`
            );
            return;
          case TransactionStatus.L2FinalizedL1Finalized:
            // Re-org safe status is currently not implemented
            break;
        }
      } else {
        console.log(
          `\tChecking transaction status again in ${RETRY_INTERVAL_SEC} seconds`
        );
      }
    } catch (err) {
      console.log("\tTransaction not yet included in block");
    }

    await sleep(RETRY_INTERVAL_SEC * 1000);
  }
})();

/**
 * For the new user data, we will add one new public key to the list of authorized keys.
 */
function constructNewUserData() {
  const newAuthorizedAddress: `0x${string}` =
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

  const newSignersList = [...signers, newAuthorizedAddress];

  return encodeMOfNData(consumerCodehash, threshold, newSignersList);
}
function mkdir(arg0: string, arg1: { recursive: boolean }) {
  throw new Error("Function not implemented.");
}
