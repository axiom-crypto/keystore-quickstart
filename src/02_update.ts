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
  BlockTag,
  createUpdateTransactionClient,
  initAccountCounterfactual,
  initAccountFromAddress,
  TransactionStatus,
  type AccountState,
  type SponsoredAuthInputs,
  type UpdateTransactionRequest,
} from "@axiom-crypto/keystore-sdk";
import { concat, decodeAbiParameters, encodeAbiParameters } from "viem";
import { green, sleep, yellow } from "./utils";

const AXIOM_SPONSOR_CODEHASH =
  "0xa1b20564cd6cc6410266a716c9654406a15e822d4dc89c4127288da925d5c225";
const AXIOM_SPONSOR_DATA_HASH =
  "0xecf85bc51a8b47c545dad1a47e868276d0a92b7cf2716033ce77d385a6b67c4b";
const AXIOM_SPONSOR_KEYSTORE_ADDR =
  "0xb5ce21832ca3bbf53de610c6dda13d6a735b0a8ea3422aeaab678a01e298269d";
const AXIOM_SPONSOR_EOA = "0xD7548a3ED8c51FA30D26ff2D7Db5C33d27fd48f2";

const RETRY_INTERVAL_SEC = 30;
const MAX_RETRIES = 20;

(async () => {
  const tomlContent = readFileSync("src/_accountKeystore.toml", "utf-8");
  const config = parse(tomlContent);

  const keystoreAddress = config.keystoreAddress as `0x${string}`;
  const nonce = BigInt(
    await nodeProvider.getTransactionCount({
      address: keystoreAddress,
      block: BlockTag.Latest,
    })
  );

  // Initialize KeystoreAccount object based on whether the account is counterfactual or not.
  let keystoreAccount;
  let eoaAddrs: `0x${string}`[];
  if (nonce === 0n) {
    keystoreAccount = initAccountCounterfactual({
      salt: config.salt as `0x${string}`,
      dataHash,
      vkey,
    });
    eoaAddrs = signers;
  } else {
    const state: AccountState = await nodeProvider.getStateAt({
      address: keystoreAddress,
      block: BlockTag.Latest,
    });

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

    keystoreAccount = initAccountFromAddress({
      address: keystoreAddress,
      dataHash: state.dataHash,
      vkey,
    });
  }

  // Fetch how much the sequencer is charging for `feePerGas`
  const feePerGas = await sequencerProvider.gasPrice();

  const sponsorAcct = initAccountFromAddress({
    address: AXIOM_SPONSOR_KEYSTORE_ADDR,
    dataHash: AXIOM_SPONSOR_DATA_HASH,
    vkey,
    nodeClient: nodeProvider,
  });

  const newUserData = constructNewUserData();
  const updateTx = await createUpdateTransactionClient({
    newUserData,
    newUserVkey: vkey,
    userAcct: keystoreAccount,
    sponsorAcct,
    feePerGas,
  });

  const userSig = await updateTx.sign(privKey1);

  const sponsoredAuthInputs = {
    sponsorAuthInputs: signatureProverProvider.makeAuthInputs({
      codehash: AXIOM_SPONSOR_CODEHASH,
      signatures: [],
      signersList: [AXIOM_SPONSOR_EOA],
    }),
    userAuthInputs: signatureProverProvider.makeAuthInputs({
      codehash: consumerCodehash,
      signatures: [userSig],
      signersList: eoaAddrs,
    }),
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
      [AXIOM_SPONSOR_CODEHASH, 0n, [AXIOM_SPONSOR_EOA]]
    ),
  ]);

  console.log(sponsoredAuthInputs);

  console.log(
    `Sending request to generate ZK proof to signature prover RPC...\n\t${green(
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
    await signatureProverProvider.authenticateSponsoredTransaction({
      transaction: updateTx.toBytes(),
      sponsoredAuthInputs,
    });

  console.log(`${yellow("\tRequest hash: ")} ${requestHash}\n`);
  console.log(
    "Waiting for sponsor authentication to complete. This typically takes ~4 minutes..."
  );

  // Write the transaction request to a file for debugging purposes
  try {
    mkdirSync("src/debug", { recursive: true });
    const txJson = JSON.stringify(
      updateTx.toTypedData(),
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
        await signatureProverProvider.getSponsoredAuthenticationStatus({
          requestHash,
        });
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
  const txHash = await sequencerProvider.sendRawTransaction({
    data: authenticatedTx,
  });
  console.log("\tKeystore Tx Hash:", txHash);

  console.log();
  console.log("Waiting for transaction to be finalized...");

  // Polls the transaction receipt until it's finalized
  let currentStatus = "";
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const receipt = await nodeProvider.getTransactionReceipt({
        hash: txHash,
      });

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
              } --rpc-url https://keystore-rpc-node.axiom.xyz | jq\n\nVerify the transaction updated the keystore account state using:\ncast rpc keystore_getStateAt ${keystoreAddress} "latest" --rpc-url https://keystore-rpc-node.axiom.xyz | jq`
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

  return signatureProverProvider.keyDataEncoder({
    codehash: consumerCodehash,
    m: threshold,
    signersList: newSignersList,
  });
}
