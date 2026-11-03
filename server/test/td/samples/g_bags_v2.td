/**
 * Bag of Holding merchant dialog.
 * Simple buy/refuse dialog tree with creature ID variable.
 */

function state0() {
  if (NumTimesTalkedTo(0)) {
    say(tra(20))
    reply(tra(21)).goTo(state1)
    reply(tra(22)).goTo(state2)
  }
}

function state1() {
  say(tra(23))
  // @26 = ~~
  reply(tra(24)).action(SetNumTimesTalkedTo(0), EscapeArea()).journal(tra(26)).exit()
}

function state2() {
  say(tra(25))
  action(SetNumTimesTalkedTo(0), EscapeArea()).exit()
}

begin("%cre_id%", state0, state1, state2)
