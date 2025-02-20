# Keystore Quickstart

This repository houses a series of scripts to help you explore and understand the Keystore as quickly as possible.

- [Overview](#overview)
- [Running the Scripts](#running-the-scripts)
  - [Setup](#setup)
  - [`01_setup.ts`](01_setupts)
  - [`test/sendTestUserOp.ts`](#bundlesendbundlets)
  - [`02_update.ts`](#02_updatets)
    - [Re-Orgs](#re-orgs)
  - [`02a_sync.ts`](#02a_syncts)

## Overview

The scripts are meant to be run in a specific order with Base Sepolia acting as the consuming rollup and Sepolia as the L1 hosting the Keystore rollup bridge. Throughout the demos, we use Biconomy’s [Nexus](https://github.com/bcnmy/nexus), an ERC-7579–compatible smart account, as the transacting smart account. The authentication rule being enforced is an m-of-n ECDSA signature verification created by Axiom.

For reading the keystore from L2s, the [Keystore Validator](https://keystore-docs.axiom.xyz/docs/using-keystore-accounts/overview#integrating-smart-accounts-with-the-keystore-validator) from the Axiom-maintained [Keystore Periphery](https://github.com/axiom-crypto/keystore-periphery) is used. Integration with the Keystore Validator requires registration of a [Key Data Consumer](https://keystore-docs.axiom.xyz/docs/creating-a-keystore-account-type/key-data-consumer) contract to pair with a ZK-wrapped authentication rule on the keystore. The deployed Keystore Validator already has a Key Data Consumer registered for m-of-n ECDSA signature verification. The contract's source code is available [here](https://github.com/axiom-crypto/keystore-auth-ecdsa).

All deployments can be found in the [docs](https://keystore-docs.axiom.xyz/docs/developer-reference/contract-addresses).

Rather than depend on an external bundler, the scripts self-bundle the `userOp`s and require the user to provide a funded Base Sepolia private key. The scripts are as follows:

- `test/sendTestUserOp.ts`: Constructs and executes a `userOp` bundle for a keystore-enabled smart account that sends some ether to a target address. This is the only script that can be executed at any time (not order-dependent) after the setup.
- `01_setup.ts`: Deploys a keystore-enabled smart account.
- `02_update.ts`: Runs through the entire process of making an update on the keystore.
- `02a_sync.ts`: An optional extension to the update script which syncs the new state to L2.

In the following sections, we will walk through the scripts in detail. At various points, we link to the official docs where you can deepen your understanding of the flow.

## Running the Scripts

### Setup

Clone the repository.

```bash
git clone https://github.com/axiom-crypto/keystore-quickstart.git
```

Configure the environment variables in the `.env` file.

```bash
cp .env.example .env
```

In the `.env` file, the variables are:

- `SEPOLIA_RPC_URL`: The RPC URL of the Sepolia L1.
- `BASE_SEPOLIA_RPC_URL`: The RPC URL of the Base Sepolia L2.
- `KEYSTORE_NODE_RPC_URL`: The RPC URL of the Keystore Node.
- `KEYSTORE_SEQUENCER_RPC_URL`: The RPC URL of the Keystore Sequencer.
- `KEYSTORE_SIGNATURE_PROVER_RPC_URL`: The RPC URL of the Keystore Signature Prover.
- `KEYSTORE_VALIDATOR_L2_ADDRESS`: The address of the Keystore Validator on L2.
- `KEYSTORE_BRIDGE_ADDRESS`: The address of the Keystore Bridge on L1.
- `BUNDLING_PRIVATE_KEY`: The private key of the address on Base Sepolia used to self-bundle. This address must be funded.

Fill out the `src/_setup.toml` file with the desired parameters. Functional defaults are provided.

Install Foundry and jq (used later to format JSON nicely):

```bash
curl -L https://foundry.paradigm.xyz | bash
sudo apt install jq
```

Install dependencies

```bash
npm install
```

> [!NOTE]
> If you are on Windows, we highly recommend using [WSL 2](https://learn.microsoft.com/en-us/windows/wsl/install).

### `01_setup.ts`

Then, you can run the setup script with

```bash
npx tsx src/01_setup.ts
```

This script will:

- Deploy a Nexus instance.
  - Fund the smart account with some ether for userOp execution.
- Install the Keystore Validator as a module.
  - To read more about the Keystore Validator, see the [Keystore Validator docs](https://keystore-docs.axiom.xyz/docs/using-keystore-accounts/overview#integrating-smart-accounts-with-the-keystore-validator).
- Counterfactually initialize a keystore account.
  - To read more about counterfactual initialization, see the [Account Initialization docs](https://keystore-docs.axiom.xyz/docs/using-keystore-accounts/counterfactual).

In addition, it will output the `_accountL2.toml` and `_accountKeystore.toml` files which contain the necessary smart account / keystore account metadata to transact on L2s and the keystore. Below are example `_accountL2.toml` and `_accountKeystore.toml` files:

```toml
# _accountL2.toml
nexusDeployment = "0x20e2dd05c3a028f21e1ddd7ff00c473eac52e7b9"
```

```toml
# _accountKeystore.toml
salt = "0x000000000000000000000000000000000000000000000000000000002b1f8a5c"
keystoreAddress = "0xa6bb3accb4dd6c5dd3b05f1b684de4b1423af0180d5e5335170438fd5d874bee"
```

- `nexusDeployment`: The address of the newly deployed Nexus smart account instance.
- `salt`: The random salt used to generate the keystore address.
- `keystoreAddress`: The newly generated keystore address.

### `test/sendTestUserOp.ts`

Run the script with

```bash
npx tsx src/test/sendTestUserOp.ts
```

This script will build the `userOp` to be executed which will include constructing the IMT proof of the state at the `keystoreAddress` relevant to the smart account. To read more about the IMT proof construction, see the [Transacting on L2s docs](https://keystore-docs.axiom.xyz/docs/using-keystore-accounts/transaction#modifying-the-useroperation-signature).

It will then send the `userOp` to the `EntryPoint` for execution. The console output will look something like:

```bash
Keystore account 0xa6bb3accb4dd6c5dd3b05f1b684de4b1423af0180d5e5335170438fd5d874bee is counterfactual.
        Data Hash: 0x453837526a5a49823d092f77606072f026128ce3bf5c2be58486da4f437fcd53
        Vkey Hash: 0x2c888117ecac3bb6b986f4a34f0766fa9c42eb4aedf1e62086ac5447257d0084
        Salt (only necessary for counterfactual accounts): 0x000000000000000000000000000000000000000000000000000000002b1f8a5c

Sent 1 wei from smart account 0x20e2dd05c3a028f21e1ddd7ff00c473eac52e7b9 to address 0x171902257ef62B882BCA7ddBd48C179eB0A50Bc5 on Base Sepolia using authentication from keystore account 0xa6bb3accb4dd6c5dd3b05f1b684de4b1423af0180d5e5335170438fd5d874bee
        Bundle Tx Hash: 0x8302db5d733ba1c209dca7410697d16c97fb1e3ac5567fd8adbeba6904b8597b
        UserOp Hash: 0x5560639825d13724248ec293e5cc88264b5943ea0e6faf274d5ff5bd1977b832
```

Running this right after the set up step will result in transacting with a counterfactual keystore account.

### `02_update.ts`

This script will run through the entire process of making an update on the keystore. It will:

- Construct an `UpdateTransaction` that the user signs
- Send the `UpdateTransaction` to the signature prover which will generate the proof of the user's signature, generate the proof of sponsor authentication, and return a complete, serialized `UpdateTransaction` ready for submission to the sequencer
  - To read more about the signature prover, see the [Signature Prover docs](https://keystore-docs.axiom.xyz/docs/creating-a-keystore-account-type/signature-prover).
  - On testnet, sponsorship is completely free meaning that anyone can authenticate.
  - This step may take a couple minutes to complete.
- Send the transaction to the sequencer and await finalization.
  - On testnet, finalization takes place every 5 minutes (on mainnet, this will be closer to once every hour).

Run the script with

```bash
npx tsx src/02_update.ts
```

You can verify the update by querying the keystore account's state.

```bash
source .env
cast rpc keystore_getStateAt <keystoreAddress> "latest" --rpc-url $KEYSTORE_RPC_URL | jq
```

If you immediately try sending another bundle with the `sendBundle.ts` script, you might notice that it still uses the counterfactual keystore account. This means that the new update has not propagated to Base Sepolia yet which happens because Base Sepolia reads L1 blocks at a [delay](https://keystore-docs.axiom.xyz/docs/using-keystore-accounts/key-rotation#send-an-update-transaction-with-the-sdk#latency). In most cases, this delay is under 10 minutes, however, in the worst case, it could take up to 12 hours during sequencer downtime.

Since this is the first update for the `keystoreAddress`, you can verify the update was propagated by checking that `userOp`s are no longer using a counterfactual keystore account.

```bash
npx tsx src/test/sendTestUserOp.ts
```

If it was in fact propagated, you should see something like:

```bash
Keystore account 0x6c84bc0ad517f85f66f79382b24960cd14439e4dbf74876c4a28c98267243a2f is initialized.
        Data Hash: 0x453837526a5a49823d092f77606072f026128ce3bf5c2be58486da4f437fcd53
        Vkey Hash: 0x2c888117ecac3bb6b986f4a34f0766fa9c42eb4aedf1e62086ac5447257d0084
        Salt (always bytes32(0) for initialized accounts): 0x0000000000000000000000000000000000000000000000000000000000000000

Bundle executed at L2 block 21728573.
        Tx Hash: 0x410f6b09a2901b21bb302d9d1fbdabacae6b53a3b431fc054374947a181558d5
UserOp executed.
         UserOp Hash: 0x8ebad2e51a521f52cdf48696125674bf8ffb964fc6c32b2065bb7ab02fff9a42
```

#### Re-Orgs

If the L1 transaction finalizing your keystore update is re-orged, the prover guarantees that it will be retried. However, it does mean that propagation to L2 could take more than one epoch.

### `02a_sync.ts`

State propagation to L2 is performed by taking a keystore state root finalized on the L1 bridge and persisting it on the L2 Keystore Validator via a Merkle Trie proof. Axiom is committed running this proof following every finalization transaction or every hour, whichever is shorter.

However, in the case that this is not fast enough, you can manually execute this Merkle Trie proof with the optional `02a_sync.ts` script.

```bash
npx tsx src/02a_sync.ts
```

This script will construct a storage proof of the keystore state root and execute it on the Keystore Validator.
