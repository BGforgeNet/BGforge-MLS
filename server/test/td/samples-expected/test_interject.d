/* Generated from test_interject.td - do not edit */

INTERJECT IDRYAD1 1 MinscDryad
  == MINSCJ IF ~IsValidForPartyDialog("Minsc")~ THEN
    @100
  == IDRYAD1 IF ~IsValidForPartyDialog("Minsc")~ THEN
    @101
END IDRYAD2 1

INTERJECT_COPY_TRANS TOLGER 75 AquaTolger
  == AQUALUNJ IF ~IsValidForPartyDialogue("Aqualung")~ THEN
    @200
  == TOLGER IF ~IsValidForPartyDialogue("Aqualung")~ THEN
    @201
END
