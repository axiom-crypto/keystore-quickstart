import { readFileSync } from "fs";
import { parse } from "@iarna/toml";
import {
  dataHash,
  ecdsaConsumerCodehash,
  encodeDataHashData,
  nodeProvider,
  privKey1,
  sequencerProvider,
  signatureProverProvider,
  signers,
  threshold,
  vkey,
} from "./_setup";
import {
  AuthenticationStatusEnum,
  AXIOM_ACCOUNT,
  AXIOM_ACCOUNT_AUTH_INPUTS,
  BlockTag,
  ecdsaSign,
  KeystoreAccountBuilder,
  TransactionStatus,
  UpdateTransactionBuilder,
  type SponsorAuthInputs,
  type UpdateTransactionRequest,
} from "@axiom-crypto/keystore-sdk";
import { hexToBigInt } from "viem";

const RETRY_INTERVAL_SEC = 20;
const MAX_RETRIES = 10;

(async () => {
  const tomlContent = readFileSync("src/_setup.toml", "utf-8");
  const config = parse(tomlContent);

  const keystoreAddress = config.keystoreAddress as `0x${string}`;
  const nonce = BigInt(
    await nodeProvider.getTransactionCount(keystoreAddress, BlockTag.Latest)
  );

  let keystoreAccount;
  if (nonce === 0n) {
    keystoreAccount = KeystoreAccountBuilder.initCounterfactual(
      config.salt as `0x${string}`,
      dataHash,
      vkey
    );
  } else {
    keystoreAccount = KeystoreAccountBuilder.initWithKeystoreAddress(
      keystoreAddress,
      dataHash,
      vkey
    );
  }

  const feePerGas = await sequencerProvider.gasPrice();

  const newUserData = constructNewUserData();
  const txReq: UpdateTransactionRequest = {
    nonce: nonce,
    feePerGas: hexToBigInt(feePerGas),
    newUserData,
    newUserVkey: vkey, // We won't alter the vkey
    userAcct: keystoreAccount,
    sponsorAcct: AXIOM_ACCOUNT,
  };
  console.log("Transaction request:", txReq);
  const updateTx = UpdateTransactionBuilder.fromTransactionRequest(txReq);
  const userSig = await ecdsaSign(privKey1, updateTx.userMsgHash());

  const sponsorAuthInputs: SponsorAuthInputs = {
    sponsorAuth: AXIOM_ACCOUNT_AUTH_INPUTS,
    userAuth: {
      codeHash: ecdsaConsumerCodehash,
      signatures: [userSig],
      eoaAddrs: signers,
    },
  };

  console.log("Sending sponsor authentication request to signature prover");

  const requestHash =
    await signatureProverProvider.sponsorAuthenticateTransaction(
      updateTx.txBytes(),
      sponsorAuthInputs
    );

  console.log("Request hash:", requestHash);
  console.log(
    "Waiting for sponsor authentication to complete. This may take several minutes..."
  );

  // polls the request status until it's completed
  const authenticatedTx = await (async () => {
    while (true) {
      const status =
        await signatureProverProvider.getSponsorAuthenticationStatus(
          requestHash
        );
      console.log("Sponsor authentication status:", status.status);
      switch (status.status) {
        case AuthenticationStatusEnum.Pending:
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_INTERVAL_SEC * 1000)
          );
          continue;
        case AuthenticationStatusEnum.Failed:
          throw new Error("Transaction authentication failed");
        case AuthenticationStatusEnum.Completed:
          if (!status.authenticatedTransaction) {
            throw new Error("No authenticated transaction found");
          }
          console.log("Sponsor authentication completed");
          return status.authenticatedTransaction;
        default:
          throw new Error("Invalid authentication status");
      }
    }
  })();

  console.log("Sending transaction to sequencer");
  const txHash = await sequencerProvider.sendRawTransaction(authenticatedTx);
  console.log("Transaction sent to sequencer", txHash);

  let currentStatus = "";

  // polls the transaction receipt until it's finalized
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const receipt = await nodeProvider.getTransactionReceipt(txHash);
      if (receipt.status !== currentStatus) {
        currentStatus = receipt.status;
        console.log("Transaction receipt:", receipt);
      }
      if (currentStatus === TransactionStatus.L2FinalizedL1Included) {
        console.log("Success: transaction finalized!");
        return;
      }
      console.log(
        `Checking transaction status again in ${RETRY_INTERVAL_SEC} seconds`
      );
    } catch (err) {
      console.log("Transaction not yet included in block");
    }
    await new Promise((resolve) =>
      setTimeout(resolve, RETRY_INTERVAL_SEC * 1000)
    );
  }
})();

/**
 * For the new user data, we will add one new public key to the list of authorized keys.
 */
function constructNewUserData() {
  const newAuthorizedAddress: `0x${string}` =
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

  const newSignersList = [...signers, newAuthorizedAddress];

  return encodeDataHashData(ecdsaConsumerCodehash, threshold, newSignersList);
}
