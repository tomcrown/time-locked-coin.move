module time_locked_deposit::deposit;

use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;

/// ================================
/// Error codes
/// ================================
/// Each error constant represents a unique failure condition.
/// These are used with `assert!` checks to enforce invariants.
const EInvalidDuration: u64 = 0;     // Duration must be > 0
const ETooEarly: u64 = 1;            // Attempt to withdraw before unlock time
const EInvalidAmount: u64 = 2;       // Deposit amount must be > 0
const EDurationTooLong: u64 = 3;     // Duration exceeds max allowed
const EUnauthorized: u64 = 4;        // Caller not authorized for action
const EInvalidRecipient: u64 = 5;    // Recipient cannot equal depositor

/// ================================
/// Time constants
/// ================================
const MS_PER_MINUTE: u64 = 60000;              // Milliseconds in one minute
const MAX_DURATION_MINUTES: u64 = 525600;      // Maximum duration = 1 year

/// ================================
/// Core State Objects
/// ================================

/// Represents a time-locked deposit.
/// Holds locked balance, participants, and timing info.
/// Stored on-chain as a shared object until withdrawn.
public struct TimeDeposit<phantom CoinType> has key {
    id: UID,                     // Unique object ID
    balance: Balance<CoinType>,  // Locked coin balance
    depositor: address,          // Address who created deposit
    recipient: address,          // Address allowed to withdraw after unlock
    start_time: u64,             // Deposit creation timestamp (ms)
    duration: u64,               // Duration in ms
    unlock_time: u64,            // Absolute unlock timestamp (ms)
}

/// Event emitted when a deposit is created.
public struct DepositCreated<phantom CoinType> has copy, drop, store {
    deposit_id: ID,              // ID of created deposit
    depositor: address,
    recipient: address,
    amount: u64,
    start_time: u64,
    duration: u64,
    unlock_time: u64,
}

/// Event emitted when a deposit is withdrawn.
public struct DepositWithdrawn<phantom CoinType> has copy, drop, store {
    deposit_id: ID,
    withdrawer: address,         // Address that withdrew funds
    withdraw_time: u64,          // Timestamp of withdrawal
    amount_withdrawn: u64,
    withdrawn_by: u8,            // 0 = depositor, 1 = recipient
}

/// ================================
/// Entry Functions
/// ================================

/// Create a new time-locked deposit.
/// - Coins are locked in a `TimeDeposit` object.
/// - Only the recipient can withdraw after unlock_time.
/// - Depositor may withdraw anytime before unlock_time.
public entry fun create_deposit<CoinType>(
    coin: Coin<CoinType>,        // Coin to lock
    recipient: address,          // Withdrawal recipient
    duration_minutes: u64,       // Lock duration in minutes
    clock: &Clock,               // Global clock for timestamp
    ctx: &mut TxContext
) {
    let depositor = tx_context::sender(ctx);

    // Validate duration
    assert!(duration_minutes > 0, EInvalidDuration);
    assert!(duration_minutes <= MAX_DURATION_MINUTES, EDurationTooLong);

    // Recipient cannot be the same as depositor
    assert!(recipient != depositor, EInvalidRecipient);

    // Convert coin to balance and validate positive amount
    let balance = coin::into_balance(coin);
    let amount = balance.value();
    assert!(amount > 0, EInvalidAmount);

    // Compute unlock time
    let now = clock.timestamp_ms();
    let duration_ms = duration_minutes * MS_PER_MINUTE;
    let unlock_time = now + duration_ms;

    // Create unique deposit object
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
    
    // Share deposit object on-chain
    transfer::share_object(time_deposit);

    // Emit event for monitoring / off-chain indexing
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

/// Withdraw funds by the depositor (early withdrawal).
/// - Depositor may always reclaim funds regardless of unlock_time.
/// - Useful for cancellation of deposit before recipient unlocks.
public entry fun withdraw_by_depositor<CoinType>(
    deposit: TimeDeposit<CoinType>,
    clock: &Clock,
    ctx: &mut TxContext
) {
    let sender = tx_context::sender(ctx);
    assert!(sender == deposit.depositor, EUnauthorized);

    let now = clock.timestamp_ms();
    let deposit_id = object::uid_to_inner(&deposit.id);
    
    // Deconstruct deposit and extract balance
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
    
    // Transfer full balance back to depositor
    transfer::public_transfer(coin, sender);
    
    // Emit event with withdrawn_by = 0 (depositor)
    event::emit(DepositWithdrawn<CoinType> {
        deposit_id,
        withdrawer: sender,
        withdraw_time: now,
        amount_withdrawn: amount,
        withdrawn_by: 0,
    });
    
    // Cleanup: destroy balance + delete object
    balance::destroy_zero(balance);
    object::delete(id);
}

/// Withdraw funds by the recipient (after unlock).
/// - Only allowed if current_time >= unlock_time.
/// - Prevents early access to locked funds.
public entry fun withdraw_by_recipient<CoinType>(
    deposit: TimeDeposit<CoinType>,
    clock: &Clock,
    ctx: &mut TxContext
) {
    let sender = tx_context::sender(ctx);
    let now = clock.timestamp_ms();
    
    // Must be the designated recipient
    assert!(sender == deposit.recipient, EUnauthorized);
    // Must wait until unlock_time
    assert!(now >= deposit.unlock_time, ETooEarly);
    
    let deposit_id = object::uid_to_inner(&deposit.id);
    
    // Deconstruct deposit and extract balance
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
    
    // Transfer full balance to recipient
    transfer::public_transfer(coin, sender);

    // Emit event with withdrawn_by = 1 (recipient)
    event::emit(DepositWithdrawn<CoinType> {
        deposit_id,
        withdrawer: sender,
        withdraw_time: now,
        amount_withdrawn: amount,
        withdrawn_by: 1,
    });
    
    // Cleanup: destroy balance + delete object
    balance::destroy_zero(balance);
    object::delete(id);
}

/// ================================
/// View Functions (Read-only helpers)
/// ================================

/// Returns full deposit info tuple:
/// (depositor, recipient, amount, start_time, duration, unlock_time, current_time).
/// Used for frontends and off-chain monitoring.
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

/// Returns true if the recipient can withdraw now.
/// Equivalent to `now >= unlock_time`.
public fun can_recipient_withdraw<CoinType>(
    deposit: &TimeDeposit<CoinType>,
    clock: &Clock
): bool {
    let now = clock.timestamp_ms();
    now >= deposit.unlock_time
}

/// Returns remaining time (ms) until unlock.
/// If already unlocked, returns 0.
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
