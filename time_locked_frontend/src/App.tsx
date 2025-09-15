import { useState, useEffect } from "react";
import {
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";

const PACKAGE_ID =
  "0x3267853684c621750d182868a26fbe51adc96f7e169cb435da7a57204ac4b10a";
const MODULE_NAME = "deposit"; // fix module path
const CLOCK_OBJECT_ID = "0x6";

const client = new SuiClient({ url: getFullnodeUrl("testnet") });

export default function TimeLockedDepositUI() {
  const currentAccount = useCurrentAccount();
  const { mutateAsync: signAndExecuteTransaction } =
    useSignAndExecuteTransaction();

  const [amountInput, setAmountInput] = useState("");
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [selectedDepositId, setSelectedDepositId] = useState("");
  const [coinType] = useState<string>("");
  const [info, setInfo] = useState<any | null>(null);
  const [recipientAddress, setRecipientAddress] = useState("");
  const [ownedDeposits, setOwnedDeposits] = useState<any[]>([]);
  const [loadingDeposits, setLoadingDeposits] = useState(false);
  const [loadingInfo, setLoadingInfo] = useState(false);

  const amount = parseFloat(amountInput || "0");
  const isCreateDisabled =
    !currentAccount ||
    !amount ||
    amount <= 0 ||
    durationMinutes <= 0 ||
    !recipientAddress;

  function toMist(n: number) {
    return BigInt(Math.floor(n * 1_000_000_000));
  }

  // Auto-fetch deposits when account changes
  useEffect(() => {
    if (currentAccount?.address) {
      fetchOwnedDeposits();
    } else {
      setOwnedDeposits([]);
      setInfo(null);
      setSelectedDepositId("");
    }
  }, [currentAccount?.address]);

  // Auto-fetch deposit info when selectedDepositId changes
  useEffect(() => {
    if (selectedDepositId) {
      fetchDepositInfo(selectedDepositId);
    } else {
      setInfo(null);
    }
  }, [selectedDepositId]);

  // ----------------
  // Fetch owned deposits
  // ----------------
  async function fetchOwnedDeposits() {
    if (!currentAccount?.address) return;

    setLoadingDeposits(true);
    try {
      const depositorEvents = await client.queryEvents({
        query: {
          MoveEventType: `${PACKAGE_ID}::deposit::DepositCreated<0x2::sui::SUI>`,
        },
        limit: 50,
      });

      const relevant = depositorEvents.data.filter((ev: any) => {
        const fields = ev.parsedJson;
        return (
          fields.depositor === currentAccount.address ||
          fields.recipient === currentAccount.address
        );
      });

      const deposits: any[] = [];
      for (const ev of relevant) {
        const fields = ev.parsedJson as any;
        const id = fields.deposit_id;
        try {
          const res = await client.getObject({
            id,
            options: { showContent: true },
          });
          if (res.data?.content?.dataType === "moveObject") {
            const fields = (res.data.content as any).fields;
            deposits.push({
              objectId: res.data.objectId,
              depositor: fields.depositor,
              recipient: fields.recipient,
              amount:
                fields.balance?.fields?.value ??
                fields.balance?.value ??
                fields.balance,
              start_time: fields.start_time,
              duration: fields.duration,
              unlock_time: fields.unlock_time,
              isUnlocked: Date.now() >= Number(fields.unlock_time),
            });
          }
        } catch (err) {
          console.warn("Failed to fetch deposit", id, err);
        }
      }

      setOwnedDeposits(deposits);
    } catch (error) {
      console.error("Failed to fetch deposits:", error);
    } finally {
      setLoadingDeposits(false);
    }
  }

  // ----------------
  // Contract calls
  // ----------------
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
        arguments: [
          coin,
          tx.pure.address(recipientAddress),
          tx.pure.u64(durationMinutes),
          tx.object(CLOCK_OBJECT_ID),
        ],
      });

      await signAndExecuteTransaction({ transaction: tx });

      alert("Deposit created! Refresh to see it.");
      setAmountInput("");
      setDurationMinutes(60);

      // refresh deposits via events
      fetchOwnedDeposits();
    } catch (e: any) {
      console.error(e);
      alert(`Create deposit failed: ${e?.toString()}`);
    }
  }

  async function withdrawAsDepositor() {
    if (!selectedDepositId || !currentAccount)
      return alert("Select a deposit and connect wallet");
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULE_NAME}::withdraw_by_depositor`,
        typeArguments: [coinType?.trim() === "" ? "0x2::sui::SUI" : coinType],
        arguments: [tx.object(selectedDepositId), tx.object(CLOCK_OBJECT_ID)],
      });
      const result = (await signAndExecuteTransaction({
        transaction: tx,
      })) as any;
      const status = result?.effects?.status?.status;
      if (status === "failure") {
        const err = result?.effects?.status?.error;
        alert(`Withdraw failed: ${err}`);
        return;
      }
      alert("Withdraw successful (depositor)");
      setSelectedDepositId("");
      setInfo(null);
      // Refresh the deposits list
      fetchOwnedDeposits();
    } catch (e: any) {
      console.error(e);
      alert(`Withdraw failed: ${e?.toString()}`);
    }
  }

  async function withdrawAsRecipient() {
    if (!selectedDepositId || !currentAccount)
      return alert("Select a deposit and connect wallet");
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULE_NAME}::withdraw_by_recipient`,
        typeArguments: [coinType?.trim() === "" ? "0x2::sui::SUI" : coinType],
        arguments: [tx.object(selectedDepositId), tx.object(CLOCK_OBJECT_ID)],
      });
      const result = (await signAndExecuteTransaction({
        transaction: tx,
      })) as any;
      const status = result?.effects?.status?.status;
      if (status === "failure") {
        const err = result?.effects?.status?.error;
        alert(`Withdraw failed: ${err}`);
        return;
      }
      alert("Withdraw successful (recipient)");
      setSelectedDepositId("");
      setInfo(null);
      // Refresh the deposits list
      fetchOwnedDeposits();
    } catch (e: any) {
      console.error(e);
      alert(`Withdraw failed: ${e?.toString()}`);
    }
  }

  async function fetchDepositInfo(depositId: string) {
    if (!depositId) return;

    setLoadingInfo(true);
    try {
      const res = await client.getObject({
        id: depositId,
        options: { showContent: true },
      });
      if (res.data?.content?.dataType === "moveObject") {
        const fields = (res.data.content as any).fields;
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
        setInfo(null);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to fetch deposit info");
      setInfo(null);
    } finally {
      setLoadingInfo(false);
    }
  }

  function selectDeposit(deposit: any) {
    setSelectedDepositId(deposit.objectId);
  }

  function fmtMs(ms: number | string | undefined) {
    if (!ms) return "-";
    const n = Number(ms);
    if (Number.isNaN(n)) return "-";
    return new Date(n).toLocaleString();
  }

  function formatAmount(amount: string | number) {
    const n = Number(amount);
    if (Number.isNaN(n)) return amount;
    return (n / 1_000_000_000).toFixed(4) + " SUI";
  }

  // ----------------
  // UI
  // ----------------
  return (
    <div className="min-h-screen bg-black text-white p-4">
      <div className="relative max-w-6xl mx-auto">
        {/* Header */}
        <div className="backdrop-blur-xl bg-white/10 rounded-3xl p-8 mb-8 border border-white/20 shadow-2xl">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold bg-white bg-clip-text text-transparent">
                TimeLocked Deposits
              </h1>
            </div>
            <div className="scale-100">
              <ConnectButton />
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Left Column */}
          <div className="space-y-8">
            {/* Create Deposit Section */}
            <div className="backdrop-blur-xl bg-white/10 rounded-3xl p-8 border border-white/20 shadow-2xl">
              <div className="flex items-center mb-6">
                <h2 className="text-2xl font-bold">Create New Deposit</h2>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-3">
                    Amount (SUI)
                  </label>
                  <div className="relative">
                    <input
                      className="w-full p-4 rounded-2xl bg-white/5 border border-white/20 text-white placeholder-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/50 focus:outline-none transition-all duration-200"
                      placeholder="Enter amount (e.g. 1.5)"
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                    />
                    <div className="absolute right-4 top-1/2 transform -translate-y-1/2 text-slate-400 font-medium">
                      SUI
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-3">
                    Recipient Address
                  </label>
                  <input
                    className="w-full p-4 rounded-2xl bg-white/5 border border-white/20 text-white placeholder-slate-400 focus:border-purple-400 focus:ring-2 focus:ring-purple-400/50 focus:outline-none transition-all duration-200"
                    placeholder="0xRecipient..."
                    value={recipientAddress}
                    onChange={(e) => setRecipientAddress(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-3">
                    Lock Duration (minutes)
                  </label>
                  <input
                    type="number"
                    className="w-full p-4 rounded-2xl bg-white/5 border border-white/20 text-white placeholder-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/50 focus:outline-none transition-all duration-200"
                    value={durationMinutes}
                    onChange={(e) =>
                      setDurationMinutes(parseInt(e.target.value || "0"))
                    }
                  />
                </div>

                <button
                  onClick={createDeposit}
                  disabled={isCreateDisabled}
                  className={`w-full py-4 rounded-2xl font-semibold text-lg transition-all duration-200 ${
                    isCreateDisabled
                      ? "bg-slate-700 text-slate-400 cursor-not-allowed"
                      : "bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white shadow-lg hover:shadow-xl transform hover:scale-[1.02]"
                  }`}
                >
                  {isCreateDisabled ? "Fill All Fields" : "Create Deposit"}
                </button>
              </div>
            </div>

            {/* Actions Section */}
            {selectedDepositId && (
              <div className="backdrop-blur-xl bg-white/10 rounded-3xl p-8 border border-white/20 shadow-2xl">
                <div className="flex items-center mb-6">
                  <div>
                    <h2 className="text-2xl font-bold">Withdraw Actions</h2>
                    <p className="text-sm text-slate-300">
                      Selected: {selectedDepositId.slice(0, 16)}...
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <button
                    onClick={withdrawAsDepositor}
                    className="w-full py-4 rounded-2xl bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold text-lg transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-[1.02]"
                  >
                    Withdraw as Depositor
                  </button>
                  <button
                    onClick={withdrawAsRecipient}
                    className="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 text-white font-semibold text-lg transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-[1.02]"
                  >
                    Withdraw as Recipient
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right Column */}
          <div className="space-y-8">
            {/* Your Deposits Section */}
            <div className="backdrop-blur-xl bg-white/10 rounded-3xl p-8 border border-white/20 shadow-2xl">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center">
                  <h2 className="text-2xl font-bold">Your Deposits</h2>
                </div>
                <button
                  onClick={fetchOwnedDeposits}
                  disabled={!currentAccount || loadingDeposits}
                  className="px-6 py-3 text-sm bg-white/10 hover:bg-white/20 text-white rounded-xl font-medium transition-all duration-200 disabled:opacity-50 border border-white/20"
                >
                  {loadingDeposits ? "Loading..." : "Refresh"}
                </button>
              </div>

              {!currentAccount && (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-slate-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <svg
                      className="w-8 h-8 text-slate-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                      />
                    </svg>
                  </div>
                  <p className="text-slate-300">
                    Connect your wallet to view deposits
                  </p>
                </div>
              )}

              {currentAccount &&
                ownedDeposits.length === 0 &&
                !loadingDeposits && (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-slate-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <svg
                        className="w-8 h-8 text-slate-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                        />
                      </svg>
                    </div>
                    <p className="text-slate-300">No deposits found</p>
                    <p className="text-sm text-slate-400 mt-2">
                      Create your first deposit to get started
                    </p>
                  </div>
                )}

              {ownedDeposits.length > 0 && (
                <div className="space-y-4 max-h-96 overflow-y-auto custom-scrollbar">
                  {ownedDeposits.map((deposit) => (
                    <div
                      key={deposit.objectId}
                      className={`p-6 rounded-2xl cursor-pointer transition-all duration-200 border ${
                        selectedDepositId === deposit.objectId
                          ? "bg-blue-500/20 border-blue-400 shadow-lg transform scale-[1.02]"
                          : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"
                      }`}
                      onClick={() => selectDeposit(deposit)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center mb-2">
                            <p className="text-xl font-bold text-white">
                              {formatAmount(deposit.amount)}
                            </p>
                            <span
                              className={`ml-3 px-3 py-1 text-xs font-semibold rounded-full ${
                                deposit.isUnlocked
                                  ? "bg-green-500/20 text-green-300 border border-green-500/30"
                                  : "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30"
                              }`}
                            >
                              {deposit.isUnlocked ? "Unlocked" : "Locked"}
                            </span>
                          </div>
                          <p className="text-sm text-slate-300 mb-1">
                            To: {deposit.recipient?.slice(0, 12)}...
                          </p>
                          <p className="text-xs text-slate-400">
                            Unlock: {fmtMs(deposit.unlock_time)}
                          </p>
                        </div>
                        <div className="text-right ml-4">
                          <p className="text-xs text-slate-400">
                            ID: {deposit.objectId.slice(0, 8)}...
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Deposit Details */}
            {loadingInfo && (
              <div className="backdrop-blur-xl bg-white/10 rounded-3xl p-8 border border-white/20 shadow-2xl">
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-500 rounded-2xl flex items-center justify-center mx-auto mb-4 animate-pulse">
                    <svg
                      className="w-8 h-8 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </div>
                  <p className="text-slate-300">Loading deposit details...</p>
                </div>
              </div>
            )}

            {info && !loadingInfo && (
              <div className="backdrop-blur-xl bg-white/10 rounded-3xl p-8 border border-white/20 shadow-2xl">
                <div className="flex items-center mb-6">
                  <h2 className="text-2xl font-bold">Deposit Details</h2>
                </div>

                <div className="space-y-6">
                  <div className="grid grid-cols-1 gap-4">
                    <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                      <p className="text-sm text-slate-400 mb-1">Depositor</p>
                      <p className="font-mono text-sm text-white break-all">
                        {info.depositor}
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                      <p className="text-sm text-slate-400 mb-1">Recipient</p>
                      <p className="font-mono text-sm text-white break-all">
                        {info.recipient}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                        <p className="text-sm text-slate-400 mb-1">Amount</p>
                        <p className="text-lg font-bold text-white">
                          {formatAmount(info.amount)}
                        </p>
                      </div>

                      <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                        <p className="text-sm text-slate-400 mb-1">Status</p>
                        {Date.now() >= Number(info.unlock_time) ? (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-green-500/20 text-green-300 border border-green-500/30">
                            <div className="w-2 h-2 bg-green-400 rounded-full mr-2"></div>
                            Unlocked
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                            <div className="w-2 h-2 bg-yellow-400 rounded-full mr-2 animate-pulse"></div>
                            Locked
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                      <p className="text-sm text-slate-400 mb-1">Start Date</p>
                      <p className="text-white">{fmtMs(info.start_time)}</p>
                    </div>

                    <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                      <p className="text-sm text-slate-400 mb-1">Unlock Time</p>
                      <p className="text-white">{fmtMs(info.unlock_time)}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!selectedDepositId &&
              currentAccount &&
              ownedDeposits.length > 0 && (
                <div className="backdrop-blur-xl bg-white/10 rounded-3xl p-8 border border-white/20 shadow-2xl">
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-slate-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <svg
                        className="w-8 h-8 text-slate-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
                        />
                      </svg>
                    </div>
                    <p className="text-slate-300">
                      Select a deposit to view details
                    </p>
                    <p className="text-sm text-slate-400 mt-2">
                      Click on any deposit above to view details and perform
                      actions
                    </p>
                  </div>
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
