// Compiled by the pinned WeiDU at test time; see dlg-weidu-differential.test.ts.
// Literal ~text~ rather than @N so no TRA is needed and the compile runs with --nogame.
BEGIN ~MINIMAL~

IF ~NumTimesTalkedTo(0)~ THEN BEGIN first
  SAY ~Hello, sailor!~
  IF ~Global("x","GLOBAL",1)~ THEN DO ~SetGlobal("x","GLOBAL",2)~ GOTO second
  IF ~~ THEN EXIT
END

IF ~~ THEN BEGIN second
  SAY ~Farewell.~
  IF ~~ THEN EXIT
END
