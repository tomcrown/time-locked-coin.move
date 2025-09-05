module time_locked_deposit::deposit;


use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;


const EInvalidDuration: u64 = 0;    
const ETooEarly: u64 = 1;            
const EInvalidAmount: u64 = 2;       
const EDurationTooLong: u64 = 3;     
const EUnauthorized: u64 = 4;        
const EInvalidRecipient: u64 = 5; 


const MS_PER_MINUTE: u64 = 60000;
const MAX_DURATION_MINUTES: u64 = 525600;


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


public entry fun create_deposit<CoinType>(
    coin: Coin<CoinType>,
    recipient: address,
    duration_minutes: u64,
    clock: &Clock,
    ctx: &mut TxContext
) {
    let depositor = tx_context::sender(ctx);

    assert!(duration_minutes > 0, EInvalidDuration);
    assert!(duration_minutes <= MAX_DURATION_MINUTES, EDurationTooLong);
    assert!(recipient != depositor, EInvalidRecipient);

    let balance = coin::into_balance(coin);
    let amount = balance.value();

    assert!(amount > 0, EInvalidAmount);

    let now = clock.timestamp_ms();
    let duration_ms = duration_minutes * MS_PER_MINUTE;
    let unlock_time = now + duration_ms;

    let deposit_id = object::new(ctx);
    let deposit_id_copy = object::uid_to_inner(&deposit_id);
    
    let time_deposit = TimeDeposit {
        id: deposit_id,
        balance,
        depositor,
        recipient,
        start_time: now,
        duration: duration_ms,
        unlock_time,
    };
    
    transfer::transfer(time_deposit, depositor);

    event::emit(DepositCreated<CoinType> {
        deposit_id: deposit_id_copy,
        depositor,
        recipient,
        amount,
        start_time: now,
        duration: duration_ms,
        unlock_time,
    });
}


public entry fun withdraw_by_depositor<CoinType>(
    deposit: TimeDeposit<CoinType>,
    clock: &Clock,
    ctx: &mut TxContext
) {
    let sender = tx_context::sender(ctx);
    assert!(sender == deposit.depositor, EUnauthorized);
    
    let now = clock.timestamp_ms();
    let deposit_id = object::uid_to_inner(&deposit.id);
    
    let TimeDeposit { 
        id, 
        mut balance, 
        depositor: _, 
        recipient: _, 
        start_time: _, 
        duration: _, 
        unlock_time: _ 
    } = deposit;
    
    let amount = balance.value();
    let coin = coin::take(&mut balance, amount, ctx);
    
    transfer::public_transfer(coin, sender);
    
    event::emit(DepositWithdrawn<CoinType> {
        deposit_id,
        withdrawer: sender,
        withdraw_time: now,
        amount_withdrawn: amount,
        withdrawn_by: 0, // 0 indicates depositor
    });
    
    balance::destroy_zero(balance);
    object::delete(id);
}


public entry fun withdraw_by_recipient<CoinType>(
    deposit: TimeDeposit<CoinType>,
    clock: &Clock,
    ctx: &mut TxContext
) {
    let sender = tx_context::sender(ctx);
    let now = clock.timestamp_ms();
    
    assert!(sender == deposit.recipient, EUnauthorized);
    assert!(now >= deposit.unlock_time, ETooEarly);
    
    let deposit_id = object::uid_to_inner(&deposit.id);
    
    let TimeDeposit { 
        id, 
        mut balance, 
        depositor: _, 
        recipient: _, 
        start_time: _, 
        duration: _, 
        unlock_time: _ 
    } = deposit;
    
    let amount = balance.value();
    let coin = coin::take(&mut balance, amount, ctx);
    
    transfer::public_transfer(coin, sender);

    event::emit(DepositWithdrawn<CoinType> {
        deposit_id,
        withdrawer: sender,
        withdraw_time: now,
        amount_withdrawn: amount,
        withdrawn_by: 1, // 1 = recipient
    });
    
    balance::destroy_zero(balance);
    object::delete(id);
}


public fun get_deposit_info<CoinType>(
    deposit: &TimeDeposit<CoinType>,
    clock: &Clock
): (address, address, u64, u64, u64, u64, u64) {
    let current_time = clock.timestamp_ms();
    (
        deposit.depositor,
        deposit.recipient,
        deposit.balance.value(),
        deposit.start_time,
        deposit.duration,
        deposit.unlock_time,
        current_time
    )
}


public fun can_recipient_withdraw<CoinType>(
    deposit: &TimeDeposit<CoinType>,
    clock: &Clock
): bool {
    let now = clock.timestamp_ms();
    now >= deposit.unlock_time
}


public fun time_until_unlock<CoinType>(
    deposit: &TimeDeposit<CoinType>,
    clock: &Clock
): u64 {
    let now = clock.timestamp_ms();
    if (now >= deposit.unlock_time) {
        0
    } else {
        deposit.unlock_time - now
    }
}