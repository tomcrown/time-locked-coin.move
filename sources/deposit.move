module time_locked_deposit::deposit;


use sui::balance::Balance;


public struct TimeDeposit<phantom CoinType> has key {
    id: UID,
    balance: Balance<CoinType>,
    depositor: address,
    recipient: address,
    start_time: u64,
    duration: u64,
    unlock_time: u64,
}

