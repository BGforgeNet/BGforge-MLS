/**
 * Smarter familiars dialog.
 * Configures familiar behavior: follow/speed, combat tactics, potions, loot pickup.
 * @tra smarter_familiars.tra
 */

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function g_familiar_follow() {
  say(tra(100))

  if (Global("g_FamFollowMaster", "GLOBAL", 0)) {
    reply(tra(201)).action(SetGlobal("g_FamFollowMaster", "GLOBAL", 1)).goTo(g_familiar_confirm)
  }
  if (Global("g_FamFollowMaster", "GLOBAL", 1)) {
    reply(tra(202))
    .action(SetGlobal("g_FamFollowMaster", "GLOBAL", 0))
      .goTo(g_familiar_confirm)
  }
  if (Global("g_FamSpeed", "GLOBAL", 0)) {
    reply(tra(203)).action(
      SetGlobal("g_FamSpeed", "GLOBAL", 1),
      ApplySpellRES("G_FSPED1", "%death_var%"),
    ).goTo(g_familiar_confirm)
  }
  if (Global("g_FamSpeed", "GLOBAL", 1)) {
    reply(tra(204)).action(
      SetGlobal("g_FamSpeed", "GLOBAL", 0),
      ApplySpellRES("G_FSPED0", "%death_var%"),
    ).goTo(g_familiar_confirm)
  }
  reply(tra(205)).extern("%dialog%", "%state%")
}

function g_familiar_combat() {
  /*
   * g_FamJumpToPack
   *   0: never hide
   *   1: hide when see enemies
   *   2: hide when see enemies and injured
   *   3: hide when see enemies and badly injured
   */
  say(tra(100))

  // hide when see enemies
  if (!Global("g_FamJumpToPack", "GLOBAL", 1)) {
    reply(tra(301)).action(SetGlobal("g_FamJumpToPack", "GLOBAL", 1)).goTo(g_familiar_confirm)
  }
  // hide when injured
  if (!Global("g_FamJumpToPack", "GLOBAL", 2)) {
    reply(tra(303)).action(SetGlobal("g_FamJumpToPack", "GLOBAL", 2)).goTo(g_familiar_confirm)
  }
  // hide when badly injured
  if (!Global("g_FamJumpToPack", "GLOBAL", 3)) {
    reply(tra(304)).action(SetGlobal("g_FamJumpToPack", "GLOBAL", 3)).goTo(g_familiar_confirm)
  }
  // never hide
  if (!Global("g_FamJumpToPack", "GLOBAL", 0)) {
    reply(tra(302)).action(SetGlobal("g_FamJumpToPack", "GLOBAL", 0)).goTo(g_familiar_confirm)
  }

  // jump out self
  if (Global("g_FamiliarJumpOut", "GLOBAL", 0)) {
    reply(tra(306)).action(SetGlobal("g_FamiliarJumpOut", "GLOBAL", 1)).goTo(g_familiar_confirm)
  }
  // don't ever jump out
  if (Global("g_FamiliarJumpOut", "GLOBAL", 1)) {
    reply(tra(307)).action(SetGlobal("g_FamiliarJumpOut", "GLOBAL", 0)).goTo(g_familiar_confirm)
  }

  // no notification when hurt
  if (Global("g_FamHurtNotif", "GLOBAL", 1) || Global("g_FamBadlyHurtNotif", "GLOBAL", 1)) {
    reply(tra(309)).action(
      SetGlobal("g_FamHurtNotif", "GLOBAL", 0),
      SetGlobal("g_FamBadlyHurtNotif", "GLOBAL", 0),
    ).goTo(g_familiar_confirm)
  }
  // notification when hurt
  if (Global("g_FamHurtNotif", "GLOBAL", 0)) {
    reply(tra(310)).action(
      SetGlobal("g_FamHurtNotif", "GLOBAL", 1),
      SetGlobal("g_FamBadlyHurtNotif", "GLOBAL", 0),
    ).goTo(g_familiar_confirm)
  }
  // notification when badly hurt
  if (Global("g_FamBadlyHurtNotif", "GLOBAL", 0)) {
    reply(tra(311)).action(
      SetGlobal("g_FamHurtNotif", "GLOBAL", 0),
      SetGlobal("g_FamBadlyHurtNotif", "GLOBAL", 1),
    ).goTo(g_familiar_confirm)
  }

  // hit and run on
  if (Global("g_FamHitAndRun", "GLOBAL", 0)) {
    reply(tra(312)).action(SetGlobal("g_FamHitAndRun", "GLOBAL", 1)).goTo(g_familiar_confirm)
  }
  // hit and run off
  if (Global("g_FamHitAndRun", "GLOBAL", 1)) {
    reply(tra(313)).action(SetGlobal("g_FamHitAndRun", "GLOBAL", 0)).goTo(g_familiar_confirm)
  }

  // combat tactic: do nothing
  if (!Global("g_FamTactic", "GLOBAL", 0)) {
    reply(tra(314)).action(SetGlobal("g_FamTactic", "GLOBAL", 0)).goTo(g_familiar_confirm)
  }
  // combat tactic: attack nearest
  if (!Global("g_FamTactic", "GLOBAL", 1)) {
    reply(tra(315)).action(SetGlobal("g_FamTactic", "GLOBAL", 1)).goTo(g_familiar_confirm)
  }
  // combat tactic: attack nearest spellcaster
  if (!Global("g_FamTactic", "GLOBAL", 2)) {
    reply(tra(316)).action(SetGlobal("g_FamTactic", "GLOBAL", 2)).goTo(g_familiar_confirm)
  }

  reply(tra(105)).extern("%dialog%", "%state%")
}

function g_familiar_potions() {
  say(tra(104))

  /*
   * For some reason, the whole stack of goodberries gets removed
   *
   * + ~PartyHasItem("gberry")~ //goodberry
   * + @251 DO ~
   *            CreateCreature("g_spy1",[-1.-1],0)
   *            GiveItemCreate("gberry",Myself,1,0,0)
   *            ActionOverride("g_spy1", TakePartyItemNum("gberry",2) )
   *            UseItem("gberry",Myself)
   *           ~
   * + g_familiar_confirm
   *
   * + ~!PartyHasItem("gberry")
   *     PartyHasItem("gberry2")~ //here and below - d0tweak goodberries
   * + @251 DO ~
   *            CreateCreature("g_spy1",[-1.-1],0)
   *            GiveItemCreate("gberry2",Myself,1,0,0)
   *            ActionOverride("g_spy1", TakePartyItemNum("gberry2",2) )
   *            UseItem("gberry2",Myself)
   *           ~
   * + g_familiar_confirm
   *
   * + ~!PartyHasItem("gberry")
   *    !PartyHasItem("gberry2")
   *     PartyHasItem("gberry3")~
   * + @251 DO ~
   *            CreateCreature("g_spy1",[-1.-1],0)
   *            GiveItemCreate("gberry3",Myself,1,0,0)
   *            ActionOverride("g_spy1", TakePartyItemNum("gberry3",2) )
   *            UseItem("gberry3",Myself)
   *           ~
   * + g_familiar_confirm
   *
   * + ~!PartyHasItem("gberry")
   *    !PartyHasItem("gberry2")
   *    !PartyHasItem("gberry3")
   *     PartyHasItem("gberry4")~
   * + @251 DO ~
   *            CreateCreature("g_spy1",[-1.-1],0)
   *            GiveItemCreate("gberry4",Myself,1,0,0)
   *            ActionOverride("g_spy1", TakePartyItemNum("gberry4",2) )
   *            UseItem("gberry4",Myself)
   *           ~
   * + g_familiar_confirm
   *
   * + ~!PartyHasItem("gberry")
   *    !PartyHasItem("gberry2")
   *    !PartyHasItem("gberry3")
   *    !PartyHasItem("gberry4")
   *     PartyHasItem("gberry5")~
   * + @251 DO ~
   *            CreateCreature("g_spy1",[-1.-1],0)
   *            GiveItemCreate("gberry5",Myself,1,0,0)
   *            ActionOverride("g_spy1", TakePartyItemNum("gberry5",2) )
   *            UseItem("gberry5",Myself)
   *           ~
   * + g_familiar_confirm
   *
   * + ~!PartyHasItem("gberry")
   *    !PartyHasItem("gberry2")
   *    !PartyHasItem("gberry3")
   *    !PartyHasItem("gberry4")
   *    !PartyHasItem("gberry5")
   *     PartyHasItem("gberry6")~
   * + @251 DO ~
   *            CreateCreature("g_spy1",[-1.-1],0)
   *            GiveItemCreate("gberry6",Myself,1,0,0)
   *            ActionOverride("g_spy1", TakePartyItemNum("gberry6",2) )
   *            UseItem("gberry6",Myself)
   *           ~
   * + g_familiar_confirm
   *
   * + ~!PartyHasItem("gberry")
   *    !PartyHasItem("gberry2")
   *    !PartyHasItem("gberry3")
   *    !PartyHasItem("gberry4")
   *    !PartyHasItem("gberry5")
   *    !PartyHasItem("gberry6")
   *     PartyHasItem("gberry7")~
   * + @251 DO ~
   *            CreateCreature("g_spy1",[-1.-1],0)
   *            GiveItemCreate("gberry7",Myself,1,0,0)
   *            ActionOverride("g_spy1", TakePartyItemNum("gberry7",2) )
   *            UseItem("gberry7",Myself)
   *           ~
   * + g_familiar_confirm
   * // Finally, goodberries are finished
   */

  // generated in main.tpa, a state for each potion
  action_drink()
  reply(tra(105)).extern("%dialog%", "%state%")
}

function g_familiar_loot() {
  say(tra(100))

  reply(tra(400)).action(
    SetGlobal("g_FamPickupGold", "GLOBAL", 0),
    SetGlobal("g_FamPickupJewels", "GLOBAL", 0),
    SetGlobal("g_FamPickupAmmo", "GLOBAL", 0),
    SetGlobal("g_FamPickupPotions", "GLOBAL", 0),
    SetGlobal("g_FamPickupScrolls", "GLOBAL", 0),
    SetGlobal("g_FamPickupTrophy", "GLOBAL", 0),
    SetGlobal("g_FamPickupScalps", "GLOBAL", 0),
  ).goTo(g_familiar_confirm)

  reply(tra(401)).action(
    SetGlobal("g_FamPickupGold", "GLOBAL", 1),
    SetGlobal("g_FamPickupJewels", "GLOBAL", 1),
    SetGlobal("g_FamPickupAmmo", "GLOBAL", 1),
    SetGlobal("g_FamPickupPotions", "GLOBAL", 1),
    SetGlobal("g_FamPickupScrolls", "GLOBAL", 1),
    SetGlobal("g_FamPickupTrophy", "GLOBAL", 1),
    SetGlobal("g_FamPickupScalps", "GLOBAL", 1),
  ).goTo(g_familiar_confirm)

  if (Global("g_FamPickupGold", "GLOBAL", 0)) {
    reply(tra(402)).action(SetGlobal("g_FamPickupGold", "GLOBAL", 1)).goTo(g_familiar_confirm)
  }
  if (Global("g_FamPickupGold", "GLOBAL", 1)) {
    reply(tra(403)).action(SetGlobal("g_FamPickupGold", "GLOBAL", 0)).goTo(g_familiar_confirm)
  }

  if (!Global("g_FamPickupJewels", "GLOBAL", 1)) {
    reply(tra(404)).action(SetGlobal("g_FamPickupJewels", "GLOBAL", 1)).goTo(g_familiar_confirm)
  }
  if (!Global("g_FamPickupJewels", "GLOBAL", 2)) {
    reply(tra(405)).action(SetGlobal("g_FamPickupJewels", "GLOBAL", 2)).goTo(g_familiar_confirm)
  }
  if (!Global("g_FamPickupJewels", "GLOBAL", 3)) {
    reply(tra(406)).action(SetGlobal("g_FamPickupJewels", "GLOBAL", 3)).goTo(g_familiar_confirm)
  }
  if (!Global("g_FamPickupJewels", "GLOBAL", 0)) {
    reply(tra(407)).action(SetGlobal("g_FamPickupJewels", "GLOBAL", 0)).goTo(g_familiar_confirm)
  }

  if (Global("g_FamPickupAmmo", "GLOBAL", 0)) {
    reply(tra(408)).action(SetGlobal("g_FamPickupAmmo", "GLOBAL", 1)).goTo(g_familiar_confirm)
  }
  if (Global("g_FamPickupAmmo", "GLOBAL", 1)) {
    reply(tra(409)).action(SetGlobal("g_FamPickupAmmo", "GLOBAL", 0)).goTo(g_familiar_confirm)
  }

  if (Global("g_FamPickupPotions", "GLOBAL", 0)) {
    reply(tra(410)).action(SetGlobal("g_FamPickupPotions", "GLOBAL", 1)).goTo(g_familiar_confirm)
  }
  if (Global("g_FamPickupPotions", "GLOBAL", 1)) {
    reply(tra(411)).action(SetGlobal("g_FamPickupPotions", "GLOBAL", 0)).goTo(g_familiar_confirm)
  }

  if (Global("g_FamPickupScrolls", "GLOBAL", 0)) {
    reply(tra(412)).action(SetGlobal("g_FamPickupScrolls", "GLOBAL", 1)).goTo(g_familiar_confirm)
  }
  if (Global("g_FamPickupScrolls", "GLOBAL", 1)) {
    reply(tra(413)).action(SetGlobal("g_FamPickupScrolls", "GLOBAL", 0)).goTo(g_familiar_confirm)
  }

  if (Global("g_FamPickupScalps", "GLOBAL", 0)) {
    reply(tra(414)).action(SetGlobal("g_FamPickupScalps", "GLOBAL", 1)).goTo(g_familiar_confirm)
  }
  if (Global("g_FamPickupScalps", "GLOBAL", 1)) {
    reply(tra(415)).action(SetGlobal("g_FamPickupScalps", "GLOBAL", 0)).goTo(g_familiar_confirm)
  }

  if (Global("g_FamPickupTrophy", "GLOBAL", 0)) {
    reply(tra(416)).action(SetGlobal("g_FamPickupTrophy", "GLOBAL", 1)).goTo(g_familiar_confirm)
  }
  if (Global("g_FamPickupTrophy", "GLOBAL", 1)) {
    reply(tra(417)).action(SetGlobal("g_FamPickupTrophy", "GLOBAL", 0)).goTo(g_familiar_confirm)
  }

  reply(tra(418)).extern("%dialog%", "%state%")
}

function g_familiar_confirm() {
  say(tra(419))
  extern("%dialog%", "%state%")
}

// ---------------------------------------------------------------------------
// EXTEND_TOP - add menu transitions to existing state
// ---------------------------------------------------------------------------

extendTop("%dialog%", "%state%", () => {
  if (InPartySlot(LastTalkedToBy, 0)) {
    reply(tra(101)).goTo(g_familiar_follow)
  }
  if (InPartySlot(LastTalkedToBy, 0)) {
    reply(tra(102)).goTo(g_familiar_combat)
  }
  if (InPartySlot(LastTalkedToBy, 0)) {
    reply(tra(103)).goTo(g_familiar_loot)
  }
  if (InPartySlot(LastTalkedToBy, 0)) {
    reply(tra(104)).goTo(g_familiar_potions)
  }
})

// ---------------------------------------------------------------------------
// APPEND - register all states under %dialog%
// ---------------------------------------------------------------------------

append("%dialog%",
  g_familiar_follow,
  g_familiar_combat,
  g_familiar_potions,
  g_familiar_loot,
  g_familiar_confirm,
)
