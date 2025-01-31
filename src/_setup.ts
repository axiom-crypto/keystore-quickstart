import {
  createPublicClient,
  createWalletClient,
  getContract,
  http,
  keccak256,
  encodeAbiParameters,
  encodePacked,
} from "viem";
import { baseSepolia, sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  KeystoreNodeProvider,
  KeystoreSequencerProvider,
  KeystoreSignatureProverProvider,
} from "@axiom-crypto/keystore-sdk";

import { abi as EntryPointAbi } from "../abis/EntryPoint.json";
import { abi as KeystoreValidatorModuleAbi } from "../abis/KeystoreValidatorModule.json";

// ERC-4337 constants
export const invalidationTime = BigInt(6000);

// Nexus-specific constants
export const k1Validator = "0x00000004171351c442B202678c48D8AB5B321E8f";
export const nonceKey = "0x00000000DC5C2fF9B93b7897D886daCDBBF56F6671708e74";

const privKeyFunded = (process.env.PRIVATE_KEY ??
  (() => {
    throw new Error("PRIVATE_KEY is undefined");
  })()) as `0x${string}`;
export const privKey1 =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const privKey2 =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const sepoliaRpc =
  process.env.L1_RPC_URL ??
  (() => {
    throw new Error("L1_RPC_URL is undefined");
  })();
const baseSepoliaRpc =
  process.env.BASE_RPC_URL ??
  (() => {
    throw new Error("BASE_RPC_URL is undefined");
  })();
const keystoreNodeRpc =
  process.env.KEYSTORE_NODE_RPC_URL ??
  (() => {
    throw new Error("KEYSTORE_NODE_RPC_URL is undefined");
  })();
const keystoreSequencerRpc =
  process.env.KEYSTORE_SEQUENCER_RPC_URL ??
  (() => {
    throw new Error("KEYSTORE_SEQUENCER_RPC_URL is undefined");
  })();
const keystoreSignatureProverRpc =
  process.env.KEYSTORE_SIGNATURE_PROVER_RPC_URL ??
  (() => {
    throw new Error("KEYSTORE_SIGNATURE_PROVER_RPC_URL is undefined");
  })();

export const signer = privateKeyToAccount(privKeyFunded);
export const account1 = privateKeyToAccount(privKey1);
export const account2 = privateKeyToAccount(privKey2);

export const keystoreBridge: `0x${string}` =
  "0x9142BfBbA6eA6471C9eb9C39b3492F48B9a51EbF";
export const latestStateRootSlot: `0x${string}` =
  "0xc94330da5d5688c06df0ade6bfd773c87249c0b9f38b25021e2c16ab9672d000";

export const publicClientSepolia = createPublicClient({
  chain: sepolia,
  transport: http(sepoliaRpc),
});

export const walletClientSepolia = createWalletClient({
  chain: sepolia,
  transport: http(sepoliaRpc),
  account: signer,
});

export const publicClientBaseSepolia = createPublicClient({
  chain: baseSepolia,
  transport: http(baseSepoliaRpc),
});

export const walletClientBaseSepolia = createWalletClient({
  chain: baseSepolia,
  transport: http(baseSepoliaRpc),
  account: signer,
});

export const nodeProvider = new KeystoreNodeProvider(keystoreNodeRpc);
export const sequencerProvider = new KeystoreSequencerProvider(
  keystoreSequencerRpc
);
export const signatureProverProvider = new KeystoreSignatureProverProvider(
  keystoreSignatureProverRpc
);

// For self-bundling
export const entryPoint = getContract({
  address: "0x0000000071727de22e5e9d8baf0edac6f37da032",
  abi: EntryPointAbi,
  client: { public: publicClientBaseSepolia, wallet: walletClientBaseSepolia },
});

export const keystoreValidatorModule = getContract({
  address: "0xDC5C2fF9B93b7897D886daCDBBF56F6671708e74",
  abi: KeystoreValidatorModuleAbi,
  client: { public: publicClientBaseSepolia, wallet: walletClientBaseSepolia },
});

// Keystore constants
export const ecdsaConsumerCodehash =
  "0xa1b20564cd6cc6410266a716c9654406a15e822d4dc89c4127288da925d5c225";
export const threshold = BigInt(1);
export const signers = [account1.address, account2.address];
export const data = encodeDataHashData(
  ecdsaConsumerCodehash,
  threshold,
  signers
);
export const dataHash = keccak256(data);
export const vkey =
  "0x0101000000100100010001010000010000000000000000000000000000000000005e34f09e1badd1b13158510edfab5c546c5fad0bf3f432b3e30c43cd233d15073d8fba654fea9aa5752d0f2965bc43822f9c4febbed9b9ff67d7bc6d7deac62151950e7e9458e99ccdac816a57003023cb35ccb46823609e7f708ee392d207203ff53be4f960cbcf9a2d054aaa950dd27481accda50c2ee8edaa312e62c3dc06c3c7f8b93a350d854985a69bb1482a241cd0406e95cca5532b60ed4f56f43d0383ac40ea937fb5b10c5776f8f39e66a4fa0678c27cfb0ad7c4cf7eabb86ab419aa62b004534a2fecbdebcca29b7af90f5c4af931563c27afd4da97f88e20131922db6f7f31a566211c201e1480b47b4899adc95dafda721247fc096bd80a384d16";
export const vkeyHash = keccak256(vkey);

export function encodeDataHashData(
  codeHash: `0x${string}`,
  m: bigint,
  signersList: `0x${string}`[]
): `0x${string}` {
  const encoded = encodeAbiParameters(
    [
      { name: "codeHash", type: "bytes32" },
      { name: "m", type: "uint256" },
      { name: "signerList", type: "address[]" },
    ],
    [codeHash, m, signersList]
  );

  const packedEncoded = encodePacked(["bytes1", "bytes"], ["0x00", encoded]);

  return packedEncoded;
}
