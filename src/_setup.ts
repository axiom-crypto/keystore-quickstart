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
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import {
  KeystoreNodeProvider,
  KeystoreSequencerProvider,
  KeystoreSignatureProverProvider,
} from "@axiom-crypto/keystore-sdk";
import { readFileSync } from "fs";
import { parse } from "@iarna/toml";

import { abi as EntryPointAbi } from "../abis/EntryPoint.json";
import { abi as KeystoreValidatorModuleAbi } from "../abis/KeystoreValidatorModule.json";

const setup = parse(readFileSync("src/_setup.toml", "utf-8"));

// ERC-4337 constants
//@ts-expect-error
export const invalidationTime = BigInt(setup.invalidationTime);

// Nexus-specific constants
export const k1Validator = "0x00000004171351c442B202678c48D8AB5B321E8f";
export const nonceKey = "0x00000000DC5C2fF9B93b7897D886daCDBBF56F6671708e74";

const privKeyFunded = (process.env.BUNDLING_PRIVATE_KEY ??
  (() => {
    throw new Error("BUNDLING_PRIVATE_KEY is undefined");
  })()) as `0x${string}`;
//@ts-expect-error
export const privKey1 = setup.signerPrivKeys[0] as `0x${string}`;
const sepoliaRpc =
  process.env.SEPOLIA_RPC_URL ??
  (() => {
    throw new Error("SEPOLIA_RPC_URL is undefined");
  })();
const baseSepoliaRpc =
  process.env.BASE_SEPOLIA_RPC_URL ??
  (() => {
    throw new Error("BASE_SEPOLIA_RPC_URL is undefined");
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

// Keystore constants.
export const consumerCodehash = setup.consumerCodehash as `0x${string}`;
//@ts-expect-error
export const threshold = BigInt(setup.threshold);
//@ts-expect-error
export const signers = setup.signerPrivKeys.map((privKey: `0x${string}`) =>
  privateKeyToAddress(privKey)
);
export const data = encodeDataHashData(consumerCodehash, threshold, signers);
export const vkey = setup.vkey as `0x${string}`;
export const dataHash = keccak256(data);
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
