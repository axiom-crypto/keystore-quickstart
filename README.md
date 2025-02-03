# Keystore Quickstart 

This repository contains a series of scripts to help you explore and understand the Keystore as quickly as possible. The scripts are meant to be run in a specific order with Base Sepolia acting as the consuming rollup and Sepolia as the L1 hosting the Keystore rollup bridge. Throughout the demos, we use Biconomy’s [Nexus](https://github.com/bcnmy/nexus), an ERC-7579–compatible smart account, as the transacting smart account and the authentication rule being enforced is an m-of-n vkey created by Axiom.

Additionally, rather than depend on an external bundler, the scripts self-bundle the `userOp`s and require you to provide a funded Base Sepolia private key. The scripts are as follows:


- `bundle/sendBundle.ts`: Constructs and executes a `userOp` bundle for a keystore-enabled smart account. This is the only script that can be executed at any time (not order-dependent) after the setup.
- `01_setup.ts`: Deploys a keystore-enabled smart account and sends the first `userOp`.
- `02_update.ts`: Runs through the entire process of making an update on the keystore.
- `02a_sync.ts`: An optional extension to the update script which syncs the new state to L2.

In the following sections, we will walk through the scripts in detail. At various points, we link to the official docs where you can deepen your understanding of the flow.

## Setup and `01_setup.ts`

Configure the environment variables in the `.env` file.

```bash
cp .env.example .env
```

Fill out the `_setup.toml` file with the desired parameters. Functional defaults are provided.

Then, you can run the setup script with

```bash
bun run src/01_setup.ts
```

This script will:

- Deploy a Nexus instance.
- Counterfactually initialize a keystore account.
    - To read more about counterfactual initialization, see the [Account Initialization docs](https://keystore-docs.vercel.app/docs/using-keystore-accounts/counterfactual).
- Install the Keystore Validator as a module.
    - To read more about the Keystore Validator, see the [Keystore Validator docs](https://keystore-docs.vercel.app/docs/using-keystore-accounts/overview#integrating-smart-accounts-with-the-keystore-validator).
- Send the first `userOp` using the Keystore Validator.

In addition, it will output an `_account.toml` file which contains the necessary smart account / keystore account metadata to transact on L2s and the keystore. Below is an example `_account.toml` file:

```toml
nexusDeployment = "0x2915cbf304516268c8b5e74281558498613f570d"
salt = "0x000000000000000000000000000000000000000000000000000000002e493b25"
keystoreAddress = "0xdbb8e3151321148596b94e7558b8bb098a9447132f95e6aa32ee02c96c633889"
```

- `nexusDeployment`: The address of the newly deployed Nexus smart account instance.
- `salt`: The random salt used to generate the keystore address.
- `keystoreAddress`: The newly generated keystore address.

## `bundle/sendBundle.ts`

Run the script with

```bash
bun run src/bundle/sendBundle.ts
```

This script will build the `userOp` to be executed which will include constructing the IMT proof of the state at the `keystoreAddress` relevant to the smart account. To read more about the IMT proof construction, see the [Transaction on L2s docs](https://keystore-docs.vercel.app/docs/using-keystore-accounts/transaction#modifying-the-useroperation-signature).

It will then send the `userOp` to the `EntryPoint` for execution. The console output will look something like:

```bash
Using counterfactual keystore account
Bundle executed at 21418636: 0x1ea7220f268b307c18bcd38b8230303ac4e771f0a381a611d31cd533bda86a87
UserOp: 0x8a0ffffe107a1a1068e02064d1dc6179544a2634ce4a7583845bf4e33c64c898
```

Running this right after the set up step will result in transacting with a counterfactual keystore account.

## `02_update.ts`

This script will run through the entire process of making an update on the keystore. It will:

- Construct an `UpdateTransaction` that the user signs
- Send the `UpdateTransaction` to the signature prover which will generate the proof of the user's signature, generate the proof of sponsor authentication, and return a complete, serialized `UpdateTransaction` ready for submission to the sequencer
    - To read more about the signature prover, see the [Signature Prover docs](https://keystore-docs.vercel.app/docs/creating-a-keystore-account-type/signature-prover).
    - On testnet, sponsorship is completely free meaning that anyone can authenticate.
    - This step may take a couple minutes to complete.
- Send the transaction to the sequencer and await finalization.
    - On testnet, finalization takes place every 5 minutes.

Run the script with

```bash
bun run src/02_update.ts
```

You can verify the update by querying the keystore account's state.

```bash
cast rpc keystore_getStateAt <keystoreAddress> "latest' --rpc-url $KEYSTORE_RPC_URL
```

If you immediately try sending another bundle with the `sendBundle.ts` script, you might notice that it still uses the counterfactual keystore account. This means that the new update has not propagated to Base Sepolia yet. Base Sepolia reads L1 blocks at a delay of approximately one epoch, meaning you must wait ~7 minutes for the update to propagate.

Since this is the first update for the `keystoreAddress`, we can verify the update was successful by checking that `userOp`s are no longer using a counterfactual keystore account.

```bash
bun run src/bundle/sendBundle.ts
```

If the update was successful, you should see something like:

```bash
Using initialized keystore account
Bundle executed at 21426385: 0xb425b5493966fc3e379f0a3caf5ac4077dbcd4344c856bcaf5078c0a5b8e4b9e
UserOp: 0xa020078aa252fa0e3d769c2bf411c17e424fc765fa708a424e070c8919e1ac0e
```

### Re-Orgs

If the L1 transaction finalizing your keystore update is re-orged, the prover guarantees that it will be retried. However, it does mean that propagation to L2 could take more than one epoch.

## `02a_sync.ts`

State propagation to L2 is performed by taking a keystore state root finalized on the L1 bridge and persisting it on the L2 Keystore Validator via a Merkle Trie proof. Axiom is committed running this proof following every finalization transaction or every hour, whichever is shorter.

However, in the case that this is not fast enough, you can manually execute this Merkle Trie proof with the optional `02a_sync.ts` script.

```bash
bun run src/02a_sync.ts
```

This script will construct a storage proof of the keystore state root and execute it on the Keystore Validator.
