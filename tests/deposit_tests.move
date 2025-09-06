#[test_only]
module time_locked_deposit::deposit_tests;


use sui::test_scenario as ts;
use sui::test_utils::assert_eq;
use sui::clock::{
    Clock,
    create_for_testing, share_for_testing,
    increment_for_testing
};
use sui::coin::{Self, Coin};
use time_locked_deposit::deposit::{
    TimeDeposit, create_deposit, withdraw_by_depositor, withdraw_by_recipient,
    get_deposit_info, can_recipient_withdraw, time_until_unlock,
    EInvalidDuration, ETooEarly, EInvalidAmount, EDurationTooLong, EUnauthorized, EInvalidRecipient
};