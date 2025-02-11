import { concat, encodeAbiParameters, keccak256, pad } from "viem";
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
import { bold } from "../utils";

// Conditionally execute `sendBundle` if the script is run directly
if (import.meta.main) {
  sendBundle().catch((error) => {
    console.error("Error during execution:", error);
    process.exit(1);
  });
}

// Nexus-specific
// For demonstration purposes, we will send 1 wei to a random target
function constructCalldata() {
  const executeSig = "0xe9ae5c53";
  const executeMode =
    "0x0000000000000000000000000000000000000000000000000000000000000000";

  // Some random target
  const target = "0x171902257ef62B882BCA7ddBd48C179eB0A50Bc5";
  const value =
    "0x0000000000000000000000000000000000000000000000000000000000000001";
  const calldata = "0x";
  const executionCalldata = concat([target, value, calldata]);

  const executionCalldataOffset =
    "0x0000000000000000000000000000000000000000000000000000000000000040";
  const executionCalldataLength =
    "0x0000000000000000000000000000000000000000000000000000000000000034";
  const executionCalldataBuffer = concat([
    executionCalldataOffset,
    executionCalldataLength,
    executionCalldata,
  ]);

  return concat([executeSig, executeMode, executionCalldataBuffer]);
}

export async function sendBundle() {
  const l2TomlContent = readFileSync("src/_accountL2.toml", "utf-8");
  const keystoreTomlContent = readFileSync(
    "src/_accountKeystore.toml",
    "utf-8"
  );
  const l2Config = parse(l2TomlContent);
  const keystoreConfig = parse(keystoreTomlContent);
  const { packedUserOp, userOpHash } = await constructUserOp(
    l2Config.nexusDeployment as `0x${string}`,
    keystoreConfig.salt as `0x${string}`,
    keystoreConfig.keystoreAddress as `0x${string}`,
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

  console.log();
  console.log(
    `Bundle executed at L2 block ${receipt.blockNumber}.\n\tTx Hash: ${bundleTxHash}`
  );
  console.log(`UserOp executed.\n\tUserOp Hash: ${userOpHash}`);
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

// Constructs the keystore-specific userOp signature.
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

    console.log(
      `Keystore account ${keystoreAddress} is ${bold(
        "counterfactual"
      )}.\n\tData Hash: ${keccak256(
        data
      )}\n\tVkey Hash: ${vkeyHash}\n\tSalt (only necessary for counterfactual accounts): ${salt}`
    );
  } else {
    keyData = imtProof.state.data;

    console.log(
      `Keystore account ${keystoreAddress} is ${bold(
        "initialized"
      )}.\n\tData Hash: ${keccak256(
        data
      )}\n\tVkey Hash: ${vkeyHash}\n\tSalt (always bytes32(0) for initialized accounts): ${pad(
        "0x00"
      )}`
    );
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
