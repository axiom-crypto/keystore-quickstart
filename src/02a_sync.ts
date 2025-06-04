import {
  keystoreBridge,
  latestStateRootSlot,
  nodeProvider,
  publicClientBaseSepolia,
  publicClientSepolia,
  stateOracle,
} from "./_setup";
import { abi as L1BlockAbi } from "../abis/L1Block.json";
import { keccak256, pad, toHex, toRlp } from "viem";
import { hyperlink } from "./utils";
import { BlockTransactionsKind } from "@axiom-crypto/keystore-sdk";

(async () => {
  const cacheTxHash = await stateOracle.write.cacheBlockhash();
  const receipt = await publicClientBaseSepolia.waitForTransactionReceipt({
    confirmations: 1,
    hash: cacheTxHash,
  });

  const inclusionBlock = receipt.blockNumber;

  const blockNumber: bigint = (await publicClientBaseSepolia.readContract({
    address: "0x4200000000000000000000000000000000000015",
    abi: L1BlockAbi,
    functionName: "number",
    blockNumber: inclusionBlock,
  })) as bigint;

  if (!blockNumber) {
    throw new Error("Failed to get blockNumber");
  }

  const rlpBlockHeader = await _getRLPBlockHeader(blockNumber);
  const proof = await publicClientSepolia.getProof({
    address: keystoreBridge,
    storageKeys: [latestStateRootSlot],
    blockNumber: blockNumber,
  });

  const blockhash = keccak256(rlpBlockHeader);

  let outputRoot = pad(`0x${proof.storageProof[0].value.toString(16)}`);
  // Get output root preimage
  let outputRootBlockNumber = await nodeProvider.getBlockNumberByOutputRoot({
    outputRoot: outputRoot,
  });
  let block = await nodeProvider.getBlockByNumber({
    block: outputRootBlockNumber,
    txKind: BlockTransactionsKind.Hashes,
  });

  const cacheStateRootTx =
    await stateOracle.write.cacheKeystoreStateRootWithProof([
      {
        storageValue: outputRoot,
        blockHeader: rlpBlockHeader,
        accountProof: proof.accountProof,
        storageProof: proof.storageProof[0].proof,
      },
      {
        stateRoot: block.stateRoot,
        withdrawalsRoot: block.withdrawalsRoot,
        lastValidBlockhash: block.hash,
      },
    ]);

  await publicClientBaseSepolia.waitForTransactionReceipt({
    confirmations: 1,
    hash: cacheStateRootTx,
  });

  console.log(
    `Keystore state root cached.\n\tNumber of L1 Blockhash: ${hyperlink(
      blockNumber.toString(),
      `https://sepolia.etherscan.io/block/${blockNumber}`,
    )}\n\tL1 Blockhash: ${hyperlink(
      blockhash,
      `https://sepolia.etherscan.io/block/${blockhash}`,
    )}\n\tKeystore State Root Cache Tx Hash: ${hyperlink(
      cacheStateRootTx,
      `https://sepolia.basescan.org/tx/${cacheStateRootTx}`,
    )}\n\tKeystore State Root: ${toHex(proof.storageProof[0].value)}`,
  );
})();

async function _getRLPBlockHeader(l1BlockNumber: bigint) {
  const blockHeader = await publicClientSepolia.getBlock({
    blockNumber: l1BlockNumber,
  });

  let blockHeaderSetup = [
    blockHeader.parentHash,
    blockHeader.sha3Uncles,
    blockHeader.miner,
    blockHeader.stateRoot,
    blockHeader.transactionsRoot,
    blockHeader.receiptsRoot,
    blockHeader.logsBloom,
    toHex(blockHeader.difficulty),
    toHex(blockHeader.number),
    toHex(blockHeader.gasLimit),
    toHex(blockHeader.gasUsed),
    toHex(blockHeader.timestamp),
    blockHeader.extraData,
    blockHeader.mixHash,
    blockHeader.nonce,
    toHex(blockHeader.baseFeePerGas!),
    blockHeader.withdrawalsRoot!,
    toHex(blockHeader.blobGasUsed!),
    toHex(blockHeader.excessBlobGas!),
    blockHeader.parentBeaconBlockRoot!,
    // @ts-expect-error
    blockHeader.requestsHash,
  ]
    .filter((x) => x) // remove undefined items
    .map((x) => {
      if (x === "0x0") {
        return "0x" as `0x${string}`;
      }
      if (x.length % 2 !== 0) {
        return ("0x" + x.slice(2).padStart(x.length - 1, "0")) as `0x${string}`;
      }
      return x as `0x${string}`;
    });

  return toRlp(blockHeaderSetup);
}
