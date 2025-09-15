import React, { useState } from "react";
import {
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";

// ----- IMPORTANT: update these constants to match your deployed package -----
const PACKAGE_ID = "0x3267853684c621750d182868a26fbe51adc96f7e169cb435da7a57204ac4b10a"; // e.g. 0xabc...
const MODULE_NAME = "deposit"; // your Move module name
const CLOCK_OBJECT_ID = "0x6"; // common clock object id on testnet/mainnet
// ---------------------------------------------------------------------------

const client = new SuiClient({ url: getFullnodeUrl("testnet") });

export default function TimeLockedDepositUI() {
  const currentAccount = useCurrentAccount();
  const { mutateAsync: signAndExecuteTransaction } =
    useSignAndExecuteTransaction();

  // Generic UI state
  const [amountInput, setAmountInput] = useState("");
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [depositObjectId, setDepositObjectId] = useState("");
  const [coinType, setCoinType] = useState<string>("");

  const [info, setInfo] = useState<any | null>(null);

  const amount = parseFloat(amountInput || "0");

  const [recipientAddress, setRecipientAddress] = useState("");

  const isCreateDisabled =
    !currentAccount || !amount || amount <= 0 || durationMinutes <= 0 || !recipientAddress;

  const isCreateCustomDisabled =
    !currentAccount || !coinType || !amount || amount <= 0 || durationMinutes <= 0;

    

  // Utility: convert human amount to mist (assumes 9 decimals like SUI)
  function toMist(n: number) {
    return BigInt(Math.floor(n * 1_000_000_000));
  }

  // Create deposit (SUI default)
  async function createDeposit() {
    if (!currentAccount) return alert("Connect wallet first");
    if (!amount || durationMinutes <= 0) return alert("Invalid input");

    try {
      const tx = new Transaction();
      tx.setGasBudget(100000000);

      const suiAmount = toMist(amount);
      const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(suiAmount)]);

      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULE_NAME}::create_deposit`,
        typeArguments: ["0x2::sui::SUI"],
        arguments: [coin, tx.pure.u64(durationMinutes), tx.object(CLOCK_OBJECT_ID)],
      });

      const result = (await signAndExecuteTransaction({ transaction: tx })) as any;
      const digest = result?.digest || result?.effects?.transactionDigest;

      const txBlock = (await client.getTransactionBlock({
        digest,
        options: { showObjectChanges: true },
      })) as any;

      // Find created object for TimeDeposit<0x2::sui::SUI>
      const created = txBlock.objectChanges?.filter((c: any) => c.type === "created") || [];
      const depositObj = created.find((c: any) => c.objectType?.includes("TimeDeposit<0x2::sui::SUI>") || c.objectType?.includes("time_locked_deposit::TimeDeposit<0x2::sui::SUI>"));

      if (depositObj) {
        setDepositObjectId(depositObj.objectId);
        alert(`Deposit created: ${depositObj.objectId}`);
      } else {
        alert("Created, but couldn't find deposit object in events.");
      }

      setAmountInput("");
      setDurationMinutes(60);
    } catch (e: any) {
      console.error(e);
      alert(`Create deposit failed: ${e?.toString()}`);
    }
  }

  // Create deposit for custom coin type
  async function createDepositCustom() {
    if (!currentAccount) return alert("Connect wallet first");
    if (!coinType) return alert("Set coin type (full Move type)");
    if (!amount || durationMinutes <= 0) return alert("Invalid input");

    try {
      // get coins of that type from RPC
      const coins = await client.getCoins({ owner: currentAccount.address, coinType });
      if (!coins.data.length) return alert("No coins of that type found in your wallet");

      // find coin object with enough balance
      const needed = toMist(amount);
      const coinObj = coins.data.find((c: any) => BigInt(c.balance) >= needed);
      if (!coinObj) return alert("No single coin object has enough balance. Split or combine coins manually.");

      const tx = new Transaction();
      tx.setGasBudget(100000000);

      const [splitCoin] = tx.splitCoins(tx.object(coinObj.coinObjectId), [tx.pure.u64(needed)]);

      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULE_NAME}::create_deposit`,
        typeArguments: [coinType],
        arguments: [splitCoin, tx.pure.u64(durationMinutes), tx.object(CLOCK_OBJECT_ID)],
      });

      const result = (await signAndExecuteTransaction({ transaction: tx })) as any;
      const digest = result?.digest || result?.effects?.transactionDigest;

      const txBlock = (await client.getTransactionBlock({ digest, options: { showObjectChanges: true } })) as any;

      const created = txBlock.objectChanges?.filter((c: any) => c.type === "created") || [];
      const depositObj = created.find((c: any) => c.objectType?.includes(`TimeDeposit<${coinType}>`) || c.objectType?.includes(`time_locked_deposit::TimeDeposit<${coinType}>`));

      if (depositObj) {
        setDepositObjectId(depositObj.objectId);
        alert(`Deposit created: ${depositObj.objectId}`);
      } else {
        alert("Created, but couldn't find deposit object in events.");
      }

      setAmountInput("");
      setDurationMinutes(60);
    } catch (e: any) {
      console.error(e);
      alert(`Create deposit (custom) failed: ${e?.toString()}`);
    }
  }

  // Withdraw by depositor (immediate allowed)
  async function withdrawAsDepositor() {
    if (!depositObjectId || !currentAccount) return alert("Provide deposit object id and connect wallet");

    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULE_NAME}::withdraw_by_depositor`,
        typeArguments: [coinType?.trim() === "" ? "0x2::sui::SUI" : coinType],
        arguments: [tx.object(depositObjectId), tx.object(CLOCK_OBJECT_ID)],
      });

      const result = (await signAndExecuteTransaction({ transaction: tx })) as any;
      const status = result?.effects?.status?.status;
      if (status === "failure") {
        const err = result?.effects?.status?.error;
        alert(`Withdraw failed: ${err}`);
        return;
      }

      alert("Withdraw successful (depositor)");
      setDepositObjectId("");
      setInfo(null);
    } catch (e: any) {
      console.error(e);
      alert(`Withdraw failed: ${e?.toString()}`);
    }
  }

  // Withdraw by recipient (only after unlock)
  async function withdrawAsRecipient() {
    if (!depositObjectId || !currentAccount) return alert("Provide deposit object id and connect wallet");

    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULE_NAME}::withdraw_by_recipient`,
        typeArguments: [coinType?.trim() === "" ? "0x2::sui::SUI" : coinType],
        arguments: [tx.object(depositObjectId), tx.object(CLOCK_OBJECT_ID)],
      });

      const result = (await signAndExecuteTransaction({ transaction: tx })) as any;
      const status = result?.effects?.status?.status;
      if (status === "failure") {
        const err = result?.effects?.status?.error;
        alert(`Withdraw failed: ${err}`);
        return;
      }

      alert("Withdraw successful (recipient)");
      setDepositObjectId("");
      setInfo(null);
    } catch (e: any) {
      console.error(e);
      const ser = e?.toString() || "";
      if (ser.includes("code 1") || ser.includes("ETooEarly") || ser.includes("code 2")) {
        alert("Too early to withdraw. Wait until unlock time.");
      } else {
        alert(`Withdraw failed: ${ser}`);
      }
    }
  }

  // Fetch deposit info
  async function fetchDepositInfo() {
    if (!depositObjectId) return alert("Provide deposit object id");

    try {
      const res = await client.getObject({ id: depositObjectId, options: { showContent: true } });
      if (res.data?.content?.dataType === "moveObject") {
        const fields = (res.data.content as any).fields;
        // structure from Move: depositor, recipient, balance, start_time, duration, unlock_time
        setInfo({
          depositor: fields.depositor,
          recipient: fields.recipient,
          amount: fields.balance?.value ?? fields.balance,
          start_time: fields.start_time,
          duration: fields.duration,
          unlock_time: fields.unlock_time,
        });
      } else {
        alert("Object is not a TimeDeposit move object");
      }
    } catch (e) {
      console.error(e);
      alert("Failed to fetch deposit info");
    }
  }

  // Helper to format ms -> readable
  function fmtMs(ms: number | string | undefined) {
    if (!ms) return "-";
    const n = Number(ms);
    if (Number.isNaN(n)) return "-";
    return new Date(n).toLocaleString();
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-black text-white p-6">
      <div className="max-w-3xl mx-auto bg-slate-800/60 rounded-2xl p-6 shadow-lg">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">TimeLocked Deposit UI</h1>
          <ConnectButton />
        </div>

        <div className="space-y-6">
          <section className="p-4 bg-slate-900/40 rounded">
            <h2 className="font-semibold">Create Deposit (SUI)</h2>
            <label className="block mt-3 text-sm">Amount (SUI)</label>
            <input
              className="mt-1 w-full p-2 rounded bg-slate-700 text-white"
              placeholder="e.g. 1.5"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
            />

            <label className="block mt-3 text-sm">Duration (minutes)</label>
            <input
              type="number"
              className="mt-1 w-full p-2 rounded bg-slate-700 text-white"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(parseInt(e.target.value || "0"))}
            />

            

            <button
              onClick={createDeposit}
              disabled={isCreateDisabled}
              className={`mt-4 w-full px-4 py-2 rounded font-medium ${isCreateDisabled ? "bg-gray-500 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"}`}
            >
              Create Deposit (SUI)
            </button>
          </section>

          <section className="p-4 bg-slate-900/40 rounded">
            <h2 className="font-semibold">Create Deposit (Custom Coin)</h2>
            <label className="block mt-3 text-sm">Coin Type (full Move type)</label>
            <input
              className="mt-1 w-full p-2 rounded bg-slate-700 text-white"
              placeholder="e.g. 0xYourPkg::coin::COIN"
              value={coinType}
              onChange={(e) => setCoinType(e.target.value)}
            />

            <label className="block mt-3 text-sm">Amount (human units)</label>
            <input
              className="mt-1 w-full p-2 rounded bg-slate-700 text-white"
              placeholder="e.g. 100"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
            />

            <label className="block mt-3 text-sm">Duration (minutes)</label>
            <input
              type="number"
              className="mt-1 w-full p-2 rounded bg-slate-700 text-white"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(parseInt(e.target.value || "0"))}
            />

            <button
              onClick={createDepositCustom}
              disabled={isCreateCustomDisabled}
              className={`mt-4 w-full px-4 py-2 rounded font-medium ${isCreateCustomDisabled ? "bg-gray-500 cursor-not-allowed" : "bg-yellow-600 hover:bg-yellow-700"}`}
            >
              Create Deposit (Custom)
            </button>
          </section>

          <section className="p-4 bg-slate-900/40 rounded">
            <h2 className="font-semibold">Actions / Query</h2>

            <label className="block mt-2 text-sm">Deposit Object ID</label>
            <input
              className="mt-1 w-full p-2 rounded bg-slate-700 text-white"
              placeholder="enter object id"
              value={depositObjectId}
              onChange={(e) => setDepositObjectId(e.target.value)}
            />

            <div className="grid grid-cols-1 gap-3 mt-4">
              <button onClick={withdrawAsDepositor} className="w-full px-4 py-2 rounded bg-purple-600 hover:bg-purple-700">Withdraw (Depositor)</button>
              <button onClick={withdrawAsRecipient} className="w-full px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700">Withdraw (Recipient)</button>
              <button onClick={fetchDepositInfo} className="w-full px-4 py-2 rounded bg-green-600 hover:bg-green-700">Fetch Deposit Info</button>
            </div>
          </section>

          <section className="p-4 bg-slate-900/30 rounded">
            <h2 className="font-semibold">Deposit Info</h2>
            {!info && <p className="text-sm text-slate-400 mt-2">No info loaded</p>}

            {info && (
              <div className="mt-3 text-sm bg-slate-800 p-3 rounded">
                <p><strong>Depositor:</strong> {info.depositor}</p>
                <p><strong>Recipient:</strong> {info.recipient}</p>
                <p><strong>Amount (raw):</strong> {info.amount?.toString?.() ?? info.amount}</p>
                <p><strong>Start time (ms):</strong> {info.start_time}</p>
                <p><strong>Start date:</strong> {fmtMs(info.start_time)}</p>
                <p><strong>Duration (ms):</strong> {info.duration}</p>
                <p><strong>Unlock time:</strong> {fmtMs(info.unlock_time)}</p>
                <p className="mt-2"><strong>Status:</strong> {Date.now() >= Number(info.unlock_time) ? <span className="text-green-400">Unlocked</span> : <span className="text-yellow-400">Locked</span>}</p>
              </div>
            )}
          </section>

          <p className="text-xs text-slate-400">Note: update <code className="bg-slate-700 px-1 rounded">PACKAGE_ID</code> and other constants to match your deployment. This UI assumes 9 decimals (SUI-like) for amount conversion.</p>
        </div>
      </div>
    </div>
  );
}
