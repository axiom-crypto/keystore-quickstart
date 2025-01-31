import { concat, encodeAbiParameters, keccak256 } from "viem";
import {
  account1,
  data,
  entryPoint,
  keystoreValidatorModule,
  nodeProvider,
  nonceKey,
  publicClientBaseSepolia,
  signer,
  vkeyHash,
} from "../_setup";
import { readFileSync } from "fs";
import { parse } from "@iarna/toml";

// Conditionally execute `sendBundle` if the script is run directly
if (import.meta.main) {
  sendBundle().catch((error) => {
    console.error("Error during execution:", error);
    process.exit(1);
  });
}

// Nexus-specific
function constructCalldata() {
  const executeSig = "0xe9ae5c53";
  const executeMode =
    "0x0000000000000000000000000000000000000000000000000000000000000000";

  // Some random target
  const target = "0x171902257ef62B882BCA7ddBd48C179eB0A50Bc5";
  const value =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const calldata = "0x0000";
  const executionCalldata = concat([target, value, calldata]);

  const executionCalldataOffset =
    "0x0000000000000000000000000000000000000000000000000000000000000040";
  const executionCalldataLength =
    "0x0000000000000000000000000000000000000000000000000000000000000036";
  const executionCallDataBuffer = concat([
    executionCalldataOffset,
    executionCalldataLength,
    executionCalldata,
  ]);

  return concat([executeSig, executeMode, executionCallDataBuffer]);
}

export async function sendBundle() {
  const tomlContent = readFileSync("src/_setup.toml", "utf-8");
  const config = parse(tomlContent);
  const { packedUserOp, userOpHash } = await constructUserOp(
    config.nexusDeployment as `0x${string}`,
    config.salt as `0x${string}`,
    config.keystoreAddress as `0x${string}`,
    constructCalldata()
  );

  const bundleTxHash = (await entryPoint.write.handleOps([
    [packedUserOp],
    signer.address,
  ])) as `0x${string}`;
  const receipt = await publicClientBaseSepolia.waitForTransactionReceipt({
    confirmations: 1,
    hash: bundleTxHash,
  });

  console.log(`Bundle executed at ${receipt.blockNumber}: ${bundleTxHash}`);
  console.log(`UserOp: ${userOpHash}`);
}

async function constructUserOp(
  smartAccountAddress: `0x${string}`,
  salt: `0x${string}`,
  keystoreAddress: `0x${string}`,
  userOpCalldata: `0x${string}`
) {
  // Standard userOp construction
  const nextNonce = (await entryPoint.read.getNonce([
    smartAccountAddress,
    nonceKey,
  ])) as bigint;
  const packedUserOp = {
    sender: smartAccountAddress,
    nonce: nextNonce,
    initCode: "0x",
    callData: userOpCalldata,
    accountGasLimits:
      "0x000000000000000000000000000f4257000000000000000000000000000f403c",
    preVerificationGas: "90377",
    gasFees:
      "0x0000000000000000000000000010eff0000000000000000000000000011e777e",
    paymasterAndData: "0x",
    signature: "0x",
  };
  const userOpHash: `0x${string}` = (await entryPoint.read.getUserOpHash([
    packedUserOp,
  ])) as `0x${string}`;

  // Since the threshold is 1, we can use the first signer's signature
  const userOpSignature = await account1.sign({ hash: userOpHash });

  // Construct the keystore userOp signature
  packedUserOp.signature = await constructKeystoreUserOpSignature(
    userOpSignature,
    salt,
    keystoreAddress
  );

  return { packedUserOp, userOpHash };
}

async function constructKeystoreUserOpSignature(
  authData: `0x${string}`,
  salt: `0x${string}`,
  keystoreAddress: `0x${string}`
) {
  // Get the latest state root that has been cached from the keystore validator
  // module
  const latestCachedStateRoot: `0x${string}` =
    (await keystoreValidatorModule.read.latestStateRoot()) as `0x${string}`;

  // Get the block number of the latest cached state root
  const latestCachedBlockNumber = await nodeProvider.getBlockNumberByStateRoot(
    latestCachedStateRoot
  );

  // Get the IMT proof for the keystore address **against the state root
  // available in the Keystore Validator**
  const imtProof = await nodeProvider.getProof(
    keystoreAddress,
    latestCachedBlockNumber
  );

  // As an optimization, the Keystore Validator takes the isLeft sister node
  // flags as a bit-packed word. Below, we construct this word.
  const isLeft = imtProof.proof.siblings.reduce((acc, sibling, index) => {
    return acc | (BigInt(sibling.isLeft ? 1 : 0) << BigInt(index));
  }, BigInt(0));

  let exclusionExtraData: `0x${string}` = "0x";
  let keyData;
  if (imtProof.proof.isExclusionProof) {
    exclusionExtraData = concat([
      imtProof.proof.leaf.keyPrefix,
      imtProof.proof.leaf.key,
      salt,
      keccak256(imtProof.proof.leaf.value),
    ]);
    keyData = data;

    console.log("Using counterfactual keystore account");
  } else {
    keyData = imtProof.state.data;

    console.log("Using existing keystore account");
  }

  const signature = encodeAbiParameters(
    [
      {
        type: "tuple",
        name: "keyDataProof",
        components: [
          {
            type: "bool",
            name: "isExclusion",
          },
          {
            type: "bytes",
            name: "exclusionExtraData",
          },
          {
            type: "bytes1",
            name: "nextDummyByte",
          },
          {
            type: "bytes32",
            name: "nextImtKey",
          },
          {
            type: "bytes32",
            name: "vkeyHash",
          },
          {
            type: "bytes",
            name: "keyData",
          },
          {
            type: "bytes32[]",
            name: "proof",
          },
          {
            type: "uint256",
            name: "isLeft",
          },
        ],
      },
      { type: "bytes", name: "signatures" },
    ],
    [
      {
        isExclusion: imtProof.proof.isExclusionProof,
        exclusionExtraData,
        nextDummyByte: imtProof.proof.leaf.nextKeyPrefix,
        nextImtKey: imtProof.proof.leaf.nextKey,
        vkeyHash,
        keyData,
        proof: imtProof.proof.siblings.map((sibling) => sibling.hash),
        isLeft,
      },
      authData,
    ]
  );

  return signature;
}
