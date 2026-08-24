// Exercises the journal-entry flag bit, which no other fixture sets.
BEGIN ~JOURNALD~

IF ~~ THEN BEGIN entry
  SAY ~You have a new task.~
  IF ~~ THEN JOURNAL ~Investigate the tower.~ EXIT
END
