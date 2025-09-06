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


const DEPOSITOR: address = @0xA;
const RECIPIENT: address = @0xB;
const THIRD_PARTY: address = @0xC;


const MS_PER_MINUTE: u64 = 60000;
const MAX_DURATION_MINUTES: u64 = 525600; 


#[test]
fun test_create_deposit_success() {
    let mut scenario = ts::begin(DEPOSITOR); {
        let clock = create_for_testing(scenario.ctx());
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let coin: Coin<u64> = coin::mint_for_testing<u64>(1000, scenario.ctx());
        let clock = ts::take_shared<Clock>(&scenario);
        create_deposit<u64>(coin, RECIPIENT, 30, &clock, scenario.ctx()); 
        ts::return_shared(clock);
    };

    let effects = ts::next_tx(&mut scenario, DEPOSITOR);
    assert_eq(effects.num_user_events(), 1);
    scenario.end();
}


#[test]
fun test_get_deposit_info_returns_correct_data() {
    let mut scenario = ts::begin(DEPOSITOR); {
        let clock = create_for_testing(scenario.ctx());
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let coin: Coin<u64> = coin::mint_for_testing<u64>(500, scenario.ctx());
        let clock = ts::take_shared<Clock>(&scenario);
        create_deposit<u64>(coin, RECIPIENT, 60, &clock, scenario.ctx()); 
        ts::return_shared(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let deposit = ts::take_shared<TimeDeposit<u64>>(&scenario);
        let clock = ts::take_shared<Clock>(&scenario);
        
        let (depositor, recipient, amount, start_time, duration, unlock_time, current_time) 
            = get_deposit_info(&deposit, &clock);
        
        assert_eq(depositor, DEPOSITOR);
        assert_eq(recipient, RECIPIENT);
        assert_eq(amount, 500);
        assert_eq(duration, 60 * MS_PER_MINUTE);
        assert_eq(unlock_time, start_time + duration);
        assert_eq(current_time, start_time);
        
        ts::return_shared(deposit);
        ts::return_shared(clock);
    };

    scenario.end();
}


#[test]
fun test_depositor_can_withdraw_anytime() {
    let mut scenario = ts::begin(DEPOSITOR); {
        let clock = create_for_testing(scenario.ctx());
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let coin: Coin<u64> = coin::mint_for_testing<u64>(200, scenario.ctx());
        let clock = ts::take_shared<Clock>(&scenario);
        create_deposit<u64>(coin, RECIPIENT, 10, &clock, scenario.ctx()); 
        ts::return_shared(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let deposit = ts::take_shared<TimeDeposit<u64>>(&scenario);
        let clock = ts::take_shared<Clock>(&scenario);
        withdraw_by_depositor<u64>(deposit, &clock, scenario.ctx()); 
        ts::return_shared(clock);
    };

    let effects = ts::next_tx(&mut scenario, DEPOSITOR);
    assert_eq(effects.num_user_events(), 1); 
    scenario.end();
}


#[test]
fun test_recipient_can_withdraw_after_unlock() {
    let mut scenario = ts::begin(DEPOSITOR); {
        let clock = create_for_testing(scenario.ctx());
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let coin: Coin<u64> = coin::mint_for_testing<u64>(300, scenario.ctx());
        let clock = ts::take_shared<Clock>(&scenario);
        create_deposit<u64>(coin, RECIPIENT, 5, &clock, scenario.ctx()); 
        ts::return_shared(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let mut clock = ts::take_shared<Clock>(&scenario);
        increment_for_testing(&mut clock, 5 * MS_PER_MINUTE); 
        ts::return_shared(clock);
    };

    ts::next_tx(&mut scenario, RECIPIENT);

    {
        let deposit = ts::take_shared<TimeDeposit<u64>>(&scenario);
        let clock = ts::take_shared<Clock>(&scenario);
        withdraw_by_recipient<u64>(deposit, &clock, scenario.ctx()); 
        ts::return_shared(clock);
    };

    let effects = ts::next_tx(&mut scenario, RECIPIENT);
    assert_eq(effects.num_user_events(), 1); 
    scenario.end();
}


#[test]
fun test_can_recipient_withdraw_function() {
    let mut scenario = ts::begin(DEPOSITOR); {
        let clock = create_for_testing(scenario.ctx());
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let coin: Coin<u64> = coin::mint_for_testing<u64>(100, scenario.ctx());
        let clock = ts::take_shared<Clock>(&scenario);
        create_deposit<u64>(coin, RECIPIENT, 2, &clock, scenario.ctx()); 
        ts::return_shared(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let deposit = ts::take_shared<TimeDeposit<u64>>(&scenario);
        let clock = ts::take_shared<Clock>(&scenario);
        
        assert_eq(can_recipient_withdraw(&deposit, &clock), false);
        
        ts::return_shared(deposit);
        ts::return_shared(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let mut clock = ts::take_shared<Clock>(&scenario);
        increment_for_testing(&mut clock, 2 * MS_PER_MINUTE); 
        ts::return_shared(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let deposit = ts::take_shared<TimeDeposit<u64>>(&scenario);
        let clock = ts::take_shared<Clock>(&scenario);
        
        assert_eq(can_recipient_withdraw(&deposit, &clock), true);
        
        ts::return_shared(deposit);
        ts::return_shared(clock);
    };

    scenario.end();
}


#[test]
fun test_time_until_unlock_function() {
    let mut scenario = ts::begin(DEPOSITOR); {
        let clock = create_for_testing(scenario.ctx());
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let coin: Coin<u64> = coin::mint_for_testing<u64>(150, scenario.ctx());
        let clock = ts::take_shared<Clock>(&scenario);
        create_deposit<u64>(coin, RECIPIENT, 3, &clock, scenario.ctx()); 
        ts::return_shared(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let deposit = ts::take_shared<TimeDeposit<u64>>(&scenario);
        let clock = ts::take_shared<Clock>(&scenario);
        
        assert_eq(time_until_unlock(&deposit, &clock), 3 * MS_PER_MINUTE);
        
        ts::return_shared(deposit);
        ts::return_shared(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let mut clock = ts::take_shared<Clock>(&scenario);
        increment_for_testing(&mut clock, 1 * MS_PER_MINUTE); 
        ts::return_shared(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let deposit = ts::take_shared<TimeDeposit<u64>>(&scenario);
        let clock = ts::take_shared<Clock>(&scenario);
        
        assert_eq(time_until_unlock(&deposit, &clock), 2 * MS_PER_MINUTE);
        
        ts::return_shared(deposit);
        ts::return_shared(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let mut clock = ts::take_shared<Clock>(&scenario);
        increment_for_testing(&mut clock, 2 * MS_PER_MINUTE); 
        ts::return_shared(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let deposit = ts::take_shared<TimeDeposit<u64>>(&scenario);
        let clock = ts::take_shared<Clock>(&scenario);
        
        assert_eq(time_until_unlock(&deposit, &clock), 0);
        
        ts::return_shared(deposit);
        ts::return_shared(clock);
    };

    scenario.end();
}


#[test, expected_failure(abort_code = EInvalidDuration)]
fun test_create_deposit_fails_zero_duration() {
    let mut scenario = ts::begin(DEPOSITOR); {
        let clock = create_for_testing(scenario.ctx());
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let coin: Coin<u64> = coin::mint_for_testing<u64>(100, scenario.ctx());
        let clock = ts::take_shared<Clock>(&scenario);
        create_deposit<u64>(coin, RECIPIENT, 0, &clock, scenario.ctx()); 
        ts::return_shared(clock);
    };

    scenario.end();
}


#[test, expected_failure(abort_code = EInvalidAmount)]
fun test_create_deposit_fails_zero_amount() {
    let mut scenario = ts::begin(DEPOSITOR); {
        let clock = create_for_testing(scenario.ctx());
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let coin: Coin<u64> = coin::mint_for_testing<u64>(0, scenario.ctx());
        let clock = ts::take_shared<Clock>(&scenario);
        create_deposit<u64>(coin, RECIPIENT, 10, &clock, scenario.ctx()); 
        ts::return_shared(clock);
    };

    scenario.end();
}


#[test, expected_failure(abort_code = EDurationTooLong)]
fun test_create_deposit_fails_excessive_duration() {
    let mut scenario = ts::begin(DEPOSITOR); {
        let clock = create_for_testing(scenario.ctx());
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let coin: Coin<u64> = coin::mint_for_testing<u64>(100, scenario.ctx());
        let clock = ts::take_shared<Clock>(&scenario);
        create_deposit<u64>(coin, RECIPIENT, MAX_DURATION_MINUTES + 1, &clock, scenario.ctx()); 
        ts::return_shared(clock);
    };

    scenario.end();
}


#[test, expected_failure(abort_code = EInvalidRecipient)]
fun test_create_deposit_fails_same_recipient_as_depositor() {
    let mut scenario = ts::begin(DEPOSITOR); {
        let clock = create_for_testing(scenario.ctx());
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let coin: Coin<u64> = coin::mint_for_testing<u64>(100, scenario.ctx());
        let clock = ts::take_shared<Clock>(&scenario);
        create_deposit<u64>(coin, DEPOSITOR, 10, &clock, scenario.ctx()); 
        ts::return_shared(clock);
    };

    scenario.end();
}


#[test, expected_failure(abort_code = ETooEarly)]
fun test_recipient_withdraw_fails_before_unlock() {
    let mut scenario = ts::begin(DEPOSITOR); {
        let clock = create_for_testing(scenario.ctx());
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let coin: Coin<u64> = coin::mint_for_testing<u64>(100, scenario.ctx());
        let clock = ts::take_shared<Clock>(&scenario);
        create_deposit<u64>(coin, RECIPIENT, 10, &clock, scenario.ctx()); 
        ts::return_shared(clock);
    };

    ts::next_tx(&mut scenario, RECIPIENT);

    {
        let deposit = ts::take_shared<TimeDeposit<u64>>(&scenario);
        let clock = ts::take_shared<Clock>(&scenario);
        withdraw_by_recipient<u64>(deposit, &clock, scenario.ctx()); 
        ts::return_shared(clock);
    };

    scenario.end();
}


#[test, expected_failure(abort_code = EUnauthorized)]
fun test_depositor_withdraw_fails_wrong_user() {
    let mut scenario = ts::begin(DEPOSITOR); {
        let clock = create_for_testing(scenario.ctx());
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let coin: Coin<u64> = coin::mint_for_testing<u64>(100, scenario.ctx());
        let clock = ts::take_shared<Clock>(&scenario);
        create_deposit<u64>(coin, RECIPIENT, 5, &clock, scenario.ctx());
        ts::return_shared(clock);
    };

    ts::next_tx(&mut scenario, THIRD_PARTY); 

    {
        let deposit = ts::take_shared<TimeDeposit<u64>>(&scenario);
        let clock = ts::take_shared<Clock>(&scenario);
        withdraw_by_depositor<u64>(deposit, &clock, scenario.ctx()); 
        ts::return_shared(clock);
    };

    scenario.end();
}


#[test, expected_failure(abort_code = EUnauthorized)]
fun test_recipient_withdraw_fails_wrong_user() {
    let mut scenario = ts::begin(DEPOSITOR); {
        let clock = create_for_testing(scenario.ctx());
        share_for_testing(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let coin: Coin<u64> = coin::mint_for_testing<u64>(100, scenario.ctx());
        let clock = ts::take_shared<Clock>(&scenario);
        create_deposit<u64>(coin, RECIPIENT, 1, &clock, scenario.ctx());
        ts::return_shared(clock);
    };

    ts::next_tx(&mut scenario, DEPOSITOR);

    {
        let mut clock = ts::take_shared<Clock>(&scenario);
        increment_for_testing(&mut clock, 1 * MS_PER_MINUTE); 
        ts::return_shared(clock);
    };

    ts::next_tx(&mut scenario, THIRD_PARTY); 

    {
        let deposit = ts::take_shared<TimeDeposit<u64>>(&scenario);
        let clock = ts::take_shared<Clock>(&scenario);
        withdraw_by_recipient<u64>(deposit, &clock, scenario.ctx()); 
        ts::return_shared(clock);
    };

    scenario.end();
}