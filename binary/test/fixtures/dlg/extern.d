// Exercises a cross-dialog transition: the resref and next-state index of a non-terminating transition.
// Compiled together with minimal.d so WeiDU can resolve the EXTERN label.
BEGIN ~EXTERND~

IF ~NumTimesTalkedTo(0)~ THEN BEGIN start
  SAY ~Take this elsewhere.~
  IF ~~ THEN EXTERN ~MINIMAL~ second
END
