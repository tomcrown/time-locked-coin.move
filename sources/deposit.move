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


public struct DepositCreated<phantom CoinType> has copy, drop, store {
    deposit_id: ID,
    depositor: address,
    recipient: address,
    amount: u64,
    start_time: u64,
    duration: u64,
    unlock_time: u64,
}

public struct DepositWithdrawn<phantom CoinType> has copy, drop, store {
    deposit_id: ID,
    withdrawer: address,
    withdraw_time: u64,
    amount_withdrawn: u64,
    withdrawn_by: u8, 
}


