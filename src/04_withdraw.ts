import { parse } from "@iarna/toml";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import {
  consumerCodehash,
  dataHash,
  keystoreBridge,
  privKey1,
  sequencerProvider,
  signatureProverProvider,
  signer,
  signers,
  vkey,
  walletClientSepolia,
} from "./_setup";
import {
  AuthenticationStatusEnum,
  BlockTag,
  createWithdrawTransactionClient,
  initAccountCounterfactual,
  initAccountFromAddress,
  publicActionsL1,
  TransactionStatus,
  walletActionsL1,
  type AccountState,
} from "@axiom-crypto/keystore-sdk";
import { decodeAbiParameters, parseEther, publicActions } from "viem";
import { green, hyperlink, sleep, yellow } from "./utils";

const RETRY_INTERVAL_SEC = 30;
const MAX_RETRIES = 20;

(async () => {
  const tomlContent = readFileSync("src/_accountKeystore.toml", "utf-8");
  const config = parse(tomlContent);

  const keystoreAddress = config.keystoreAddress as `0x${string}`;
  const nonce = await sequencerProvider.getTransactionCount({
    address: keystoreAddress,
    block: BlockTag.Latest,
  });

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
    const state: AccountState = await sequencerProvider.getStateAt({
      address: keystoreAddress,
      block: BlockTag.Latest,
    });

    const [, , addrs] = decodeAbiParameters(
      [
        { name: "codehash", type: "uint256" },
        { name: "threshold", type: "uint256" },
        { name: "eoaAddrs", type: "address[]" },
      ],
      ("0x" + state.data.slice(4)) as `0x${string}`,
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

  // Create a withdraw transaction
  const withdrawTx = await createWithdrawTransactionClient({
    amt: parseEther("0.003"),
    to: signer.address,
    userAcct: keystoreAccount,
    nonce,
    feePerGas,
  });

  console.log("Withdraw Transaction:");
  console.log(`\tkeystoreAccount: ${keystoreAccount}`);
  console.log(`\tamount: 0.003 ETH`);
  console.log(`\tto: ${signer.address}`);

  const txSignature = await withdrawTx.sign(privKey1);

  // Create the user AuthInputs to be used in authenticating a withdraw transaction
  console.log("Authenticating withdraw transaction...");
  const userAuthInputs = signatureProverProvider.makeAuthInputs({
    codehash: consumerCodehash,
    signatures: [txSignature],
    signersList: eoaAddrs,
  });

  const requestHash = await signatureProverProvider.authenticateTransaction({
    transaction: withdrawTx.toBytes(),
    authInputs: userAuthInputs,
  });

  console.log(`${yellow("\tRequest hash: ")} ${requestHash}\n`);
  console.log(
    "Waiting for sponsor authentication to complete. This typically takes ~4 minutes...",
  );

  // Write the transaction request to a file for debugging purposes
  try {
    mkdirSync("src/debug", { recursive: true });
    const txJson = JSON.stringify(
      withdrawTx.toTypedData(),
      (_, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    );
    writeFileSync(`src/debug/${requestHash}.json`, txJson);
  } catch (err) {
    console.error("Error writing debug file", err);
  }

  // Polls the request status until it's completed
  let i = 0;
  const authenticatedTx = await (async () => {
    while (true) {
      const status = await signatureProverProvider.getAuthenticationStatus({
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
          console.log(`\t${green("Authentication completed!")}`);
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
      const receipt = await sequencerProvider.getTransactionReceipt({
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
                "\tStatus: transaction included in block and committed to L1",
              )}`,
            );
            break;
          case TransactionStatus.L2FinalizedL1Finalized:
          case TransactionStatus.L2FinalizedL1Included:
            console.log(
              `\t${green(
                `Success: keystore block ${receipt?.blockNumber!} containing withdraw transaction was finalized on L1!`,
              )}\n\nCheck the updated account balance:\n\tcast rpc keystore_getBalance ${keystoreAddress} "latest" --rpc-url https://keystore-rpc-node.axiom.xyz | jq`,
            );
            return;
        }
      } else {
        console.log(
          `\tChecking transaction status again in ${RETRY_INTERVAL_SEC} seconds`,
        );
      }
    } catch (err) {
      console.log("\tTransaction not yet included in block");
    }

    await sleep(RETRY_INTERVAL_SEC * 1000);
  }

  const l1Client = walletClientSepolia
    .extend(publicActions)
    .extend(publicActionsL1())
    .extend(walletActionsL1());

  const finalizationArgs = await sequencerProvider.buildFinalizeWithdrawalArgs({
    transactionHash: withdrawTx.txHash(),
  });
  const finalizeWithdrawalL1TxHash = await l1Client.finalizeWithdrawal({
    bridgeAddress: keystoreBridge,
    ...finalizationArgs,
  });
  console.log(
    `\tFinalized withdrawal on L1. L1 transaction hash: ${hyperlink(
      finalizeWithdrawalL1TxHash,
      `https://sepolia.etherscan.io/tx/${finalizeWithdrawalL1TxHash}`,
    )}`,
  );
})();
