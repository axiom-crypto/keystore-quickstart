import { parse } from "@iarna/toml";
import { readFileSync } from "fs";
import {
  keystoreBridge,
  sequencerProvider,
  walletClientSepolia,
} from "./_setup";
import { parseEther, publicActions } from "viem";
import {
  createDepositTransactionClient,
  getL2TransactionHashes,
  publicActionsL1,
  walletActionsL1,
} from "@axiom-crypto/keystore-sdk";
import { green, hyperlink, sleep } from "./utils";

const RETRY_INTERVAL_SEC = 30;
const MAX_RETRIES = 20;

(async () => {
  const tomlContent = readFileSync("src/_accountKeystore.toml", "utf-8");
  const config = parse(tomlContent);

  const keystoreAddress = config.keystoreAddress as `0x${string}`;

  const l1Client = walletClientSepolia
    .extend(publicActions)
    .extend(publicActionsL1())
    .extend(walletActionsL1());

  // Create a deposit transaction
  const depositTx = await createDepositTransactionClient({
    keystoreAddress,
    amt: parseEther("0.005"),
  });

  console.log("Deposit Transaction:");
  console.log(`\tkeystoreAddress:${keystoreAddress}`);
  console.log(`\tamount: 0.005 ETH`);

  // Send the deposit transaction to L1
  const depositL1TxHash = await l1Client.initiateL1Transaction({
    bridgeAddress: keystoreBridge,
    txClient: depositTx,
  });

  console.log();
  console.log("Sending deposit L1-initiated transaction to L1...");

  // Fetch deposit transaction hash and receipt
  const l1TxReceipt = await l1Client.waitForTransactionReceipt({
    hash: depositL1TxHash,
  });
  const [depositL2TxHash] = getL2TransactionHashes(l1TxReceipt);

  console.log(
    `\tL1 transaction hash: ${hyperlink(
      depositL1TxHash,
      `https://sepolia.etherscan.io/tx/${depositL1TxHash}`,
    )}`,
  );
  console.log("\tDeposit transaction hash:", depositL2TxHash);

  console.log();
  console.log(
    "Waiting for deposit transaction inclusion on Keystore. This typically takes ~6 minutes...",
  );

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const receipt = await sequencerProvider.getTransactionReceipt({
        hash: depositL2TxHash,
      });
      console.log(
        `\t${green(
          `Success: keystore block ${receipt?.blockNumber!} contains deposit transaction: ${depositL2TxHash}!`,
        )}\n\nCheck updated keystore account balance using:\n\tcast rpc keystore_getBalance ${keystoreAddress} "latest" --rpc-url https://keystore-rpc-node.axiom.xyz | jq`,
      );
      break;
    } catch (err) {
      console.log(
        `\tTransaction not yet included in block, checking again in ${RETRY_INTERVAL_SEC} seconds`,
      );
    }

    await sleep(RETRY_INTERVAL_SEC * 1000);
  }
})();
