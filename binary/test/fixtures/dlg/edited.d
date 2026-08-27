// minimal.d with one action rewritten to a LONGER string, which is the edit a preserve-mode serializer
// cannot make: the text block has to be re-laid-out and every offset after it recomputed. Compiling both
// with WeiDU makes the reference implementation the oracle for what that layout should be.
BEGIN ~EDITED~

IF ~NumTimesTalkedTo(0)~ THEN BEGIN first
  SAY ~Hello, sailor!~
  IF ~Global("x","GLOBAL",1)~ THEN DO ~SetGlobal("x","GLOBAL",2)SetGlobal("y","GLOBAL",3)~ GOTO second
  IF ~~ THEN EXIT
END

IF ~~ THEN BEGIN second
  SAY ~Farewell.~
  IF ~~ THEN EXIT
END
