import {
  createPublicClient,
  createWalletClient,
  getContract,
  http,
  keccak256,
  concat,
} from "viem";
import { baseSepolia, sepolia } from "viem/chains";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import {
  authDataEncoder,
  createNodeClient,
  createSequencerClient,
  createSignatureProverClient,
  keyDataEncoder,
  M_OF_N_ECDSA_SIG_PROVER_URL,
  M_OF_N_ECDSA_VKEY,
  makeAuthInputs,
  type CustomSignatureProver,
  type MOfNEcdsaAuthDataFields,
  type MOfNEcdsaAuthInputs,
  type MOfNEcdsaKeyDataFields,
} from "@axiom-crypto/keystore-sdk";
import { readFileSync } from "fs";
import { parse } from "@iarna/toml";
import dotenv from "dotenv";

import { abi as EntryPointAbi } from "../abis/EntryPoint.json";
import { abi as KeystoreValidatorModuleAbi } from "../abis/KeystoreValidator.json";
import { abi as StateOracleAbi } from "../abis/OPStackStateOracle.json";

dotenv.config();

const setup = parse(readFileSync("src/_setup.toml", "utf-8"));

// ERC-4337 constants
export const stateRootInvalidationTime = BigInt(setup.stateRootInvalidationTime as string | number);
export const cacheInvalidationTime = BigInt(setup.cacheInvalidationTime as string | number);
export const keyDataConsumer = setup.keyDataConsumer as `0x${string}`;

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
const keystoreValidatorAddress =
  process.env.KEYSTORE_VALIDATOR_L2_ADDRESS ??
  (() => {
    throw new Error("KEYSTORE_VALIDATOR_L2_ADDRESS is undefined");
  })();
const keystoreStateOracleAddress =
  process.env.KEYSTORE_STATE_ORACLE_L2_ADDRESS ??
  (() => {
    throw new Error("KEYSTORE_STATE_ORACLE_L2_ADDRESS is undefined");
  })();
const keystoreBridgeAddress =
  process.env.KEYSTORE_BRIDGE_ADDRESS ??
  (() => {
    throw new Error("KEYSTORE_BRIDGE_ADDRESS is undefined");
  })();

export const signer = privateKeyToAccount(privKeyFunded);
export const account1 = privateKeyToAccount(privKey1);

// Nexus-specific constants
export const k1Validator = "0x00000004171351c442B202678c48D8AB5B321E8f";
export const nonceKey = concat([
  "0x00000000",
  keystoreValidatorAddress as `0x${string}`,
]) as `0x${string}`;

export const keystoreBridge: `0x${string}` =
  keystoreBridgeAddress as `0x${string}`;
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

export const nodeProvider = createNodeClient({ url: keystoreNodeRpc });
export const sequencerProvider = createSequencerClient({
  url: keystoreSequencerRpc,
});

export const MOfNSignatureProver: CustomSignatureProver<
  MOfNEcdsaKeyDataFields,
  MOfNEcdsaAuthDataFields,
  MOfNEcdsaAuthInputs
> = {
  vkey: M_OF_N_ECDSA_VKEY,
  keyDataEncoder,
  authDataEncoder,
  makeAuthInputs,
};

export const signatureProverProvider = createSignatureProverClient({
  url: keystoreSignatureProverRpc,
  ...MOfNSignatureProver,
});

// For self-bundling
export const entryPoint = getContract({
  address: "0x0000000071727de22e5e9d8baf0edac6f37da032",
  abi: EntryPointAbi,
  client: { public: publicClientBaseSepolia, wallet: walletClientBaseSepolia },
});

export const keystoreValidatorModule = getContract({
  address: keystoreValidatorAddress as `0x${string}`,
  abi: KeystoreValidatorModuleAbi,
  client: { public: publicClientBaseSepolia, wallet: walletClientBaseSepolia },
});

export const stateOracle = getContract({
  address: keystoreStateOracleAddress as `0x{string}`,
  abi: StateOracleAbi,
  client: { public: publicClientBaseSepolia, wallet: walletClientBaseSepolia },
});

// Keystore constants.
export const consumerCodehash = setup.consumerCodehash as `0x${string}`;
//@ts-expect-error
export const threshold = BigInt(setup.threshold);
//@ts-expect-error
export const signers = setup.signerPrivKeys.map((privKey: `0x${string}`) =>
  privateKeyToAddress(privKey),
);
export const data = signatureProverProvider.keyDataEncoder({
  codehash: consumerCodehash,
  m: threshold,
  signersList: signers,
});
export const vkey = setup.vkey as `0x${string}`;
export const dataHash = keccak256(data);
export const vkeyHash = keccak256(vkey);
