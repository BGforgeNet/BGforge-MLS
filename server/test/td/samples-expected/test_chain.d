/* Generated from test_chain.td - do not edit */

BEGIN PLAYER1

IF ~~ next_state
    SAY @502
    ++ @503 EXIT
END

CHAIN
PLAYER1 greeting_chain
@100
== EDWIN
@101
== PLAYER1
@102
EXIT

CHAIN
PLAYER1 multisay_chain
@200
= @201
= @202
== EDWIN
@203
= @204
EXIT

CHAIN
PLAYER1 action_chain
@300
DO ~GiveItemCreate("SWORD01","EDWIN",1,0,0)~
== EDWIN
@301
DO ~SetGlobal("quest_started","GLOBAL",1) AddexperienceParty(1000)~
== PLAYER1
@302
EXIT

CHAIN
PLAYER1 conditional_chain
@400
== EDWIN IF ~PartyHasItem("SWORD01")~ THEN
@401
== MINSC
@402
EXIT

CHAIN
PLAYER1 goto_chain
@500
== EDWIN
@501
END PLAYER1 next_state

CHAIN
IF ~Global("quest_active","GLOBAL",1)~ THEN PLAYER1 triggered_chain
@600
== EDWIN
@601
EXIT
