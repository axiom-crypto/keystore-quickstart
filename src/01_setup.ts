import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  getContract,
  keccak256,
  pad,
  parseEther,
  slice,
  toHex,
} from "viem";
import { abi as nexusFactoryAbi } from "../abis/NexusFactory.json";
import { abi as nexusAbi } from "../abis/Nexus.json";
import {
  account1,
  dataHash,
  entryPoint,
  invalidationTime,
  k1Validator,
  keystoreValidatorModule,
  publicClientBaseSepolia,
  signer,
  vkeyHash,
  walletClientBaseSepolia,
} from "./_setup.ts";
import { stringify } from "@iarna/toml";
import { writeFileSync } from "fs";
import { hyperlink } from "./utils.ts";

// Deploy Nexus instance
// Counterfactually initialize a keystore account
// Install Keystore validator

(async () => {
  // Randomly generate a salt for counterfactual initialization
  const salt = pad(toHex(Math.floor(Math.random() * 1000000000)));
  const keystoreAddress = keccak256(concat([salt, dataHash, vkeyHash]));

  console.log(
    `Counterfactually initializing keystore account...\n\tSalt: ${salt}\n\tData Hash: ${dataHash}\n\tVkey Hash: ${vkeyHash}\n\tKeystore Address: ${keystoreAddress}`
  );
  console.log();

  const nexusDeployment = await deployNexusInstance();

  await installKeystoreValidator(
    nexusDeployment,
    invalidationTime,
    keystoreAddress
  );

  const smartAccountTomlData = {
    nexusDeployment,
  };
  const keystoreAccountTomlData = {
    salt,
    keystoreAddress,
  };
  writeFileSync("src/_accountL2.toml", stringify(smartAccountTomlData));
  writeFileSync(
    "src/_accountKeystore.toml",
    stringify(keystoreAccountTomlData)
  );
})();

async function deployNexusInstance() {
  const nexusFactory = getContract({
    address: "0x00000bb19a3579F4D779215dEf97AFbd0e30DB55",
    abi: nexusFactoryAbi,
    client: {
      public: publicClientBaseSepolia,
      wallet: walletClientBaseSepolia,
    },
  });

  const salt = pad(toHex(Math.floor(Math.random() * 1000000000)));

  let creationTxHash = await nexusFactory.write.createAccount([
    account1.address,
    salt,
    [],
    0,
  ]);
  const receipt = await publicClientBaseSepolia.waitForTransactionReceipt({
    hash: creationTxHash,
  });

  const log = receipt.logs.find(
    (log) =>
      log.topics[0] ===
      "0x33310a89c32d8cc00057ad6ef6274d2f8fe22389a992cf89983e09fc84f6cfff"
  );
  const nexusDeployment = slice(log?.topics[1]!, 12);

  console.log(
    `Nexus instance deployed at ${hyperlink(
      nexusDeployment,
      `https://sepolia.basescan.org/address/${nexusDeployment}`
    )}.\n\tTx Hash: ${hyperlink(
      receipt.transactionHash,
      `https://sepolia.basescan.org/tx/${receipt.transactionHash}`
    )}`
  );

  const sendTxHash = await walletClientBaseSepolia.sendTransaction({
    to: nexusDeployment,
    value: parseEther("0.0001"),
  });
  const sendReceipt = await publicClientBaseSepolia.waitForTransactionReceipt({
    hash: sendTxHash,
  });
  console.log(
    `Sent ether to smart account (for userOp execution).\n\tTx Hash: ${hyperlink(
      sendReceipt.transactionHash,
      `https://sepolia.basescan.org/tx/${sendReceipt.transactionHash}`
    )}`
  );

  return nexusDeployment;
}

async function installKeystoreValidator(
  nexusDeployment: `0x${string}`,
  _invalidationTime: bigint,
  _keystoreAddress: `0x${string}`
) {
  const validatorData = encodeAbiParameters(
    [{ type: "uint256" }, { type: "bytes32" }],
    [_invalidationTime, _keystoreAddress]
  );
  const validatorInstallationCalldata = encodeFunctionData({
    abi: nexusAbi,
    functionName: "installModule",
    args: [1, keystoreValidatorModule.address, validatorData],
  });

  const key = concat(["0x00000000", k1Validator]);
  let nextNonce = (await entryPoint.read.getNonce([
    nexusDeployment,
    key,
  ])) as bigint;

  const packedUserOp = {
    sender: nexusDeployment,
    nonce: nextNonce,
    initCode: "0x",
    callData: validatorInstallationCalldata,
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

  const userOpSignature = await account1.sign({ hash: userOpHash });

  packedUserOp.signature = userOpSignature;

  const bundleTxHash = await entryPoint.write.handleOps([
    [packedUserOp],
    signer.address,
  ]);

  await publicClientBaseSepolia.waitForTransactionReceipt({
    hash: bundleTxHash,
  });
  console.log(
    `Keystore validator installed.\n\tTx Hash: ${hyperlink(
      bundleTxHash,
      `https://sepolia.basescan.org/tx/${bundleTxHash}`
    )}`
  );
}
