/* Generated from pizza_chain.td - do not edit */

CHAIN
IF ~Global("KelseyImoenPizza","LOCALS",0) InParty("Imoen2") See("Imoen2") !StateCheck("Imoen2",STATE_SLEEPING)~ THEN BJKLSY pizzachain
@1
DO ~SetGlobal("KelseyImoenPizza","LOCALS",1)~
== IMOEN2J
@2
= @3
== BJKLSY
@4
== IMOEN2J
@5
== BJKLSY IF ~PartyHasItem("pepperoni")~ THEN
@6
== IMOEN2J IF ~!PartyHasItem("pepperoni")~ THEN
@7
== BJKLSY IF ~!PartyHasItem("pepperoni")~ THEN
@8
= @9
== IMOEN2J IF ~!PartyHasItem("pepperoni")~ THEN
@10
== BJKLSY IF ~!PartyHasItem("pepperoni")~ THEN
@11
EXIT
