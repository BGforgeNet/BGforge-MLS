/* Generated from g_bags_v2.td - do not edit */

BEGIN %cre_id%

IF ~NumTimesTalkedTo(0)~ state0
    SAY @20
    ++ @21 + state1
    ++ @22 + state2
END

IF ~~ state1
    SAY @23
    ++ @24 DO ~SetNumTimesTalkedTo(0) EscapeArea()~ JOURNAL @26 EXIT
END

IF ~~ state2
    SAY @25
    IF ~~ DO ~SetNumTimesTalkedTo(0) EscapeArea()~ EXIT
END
