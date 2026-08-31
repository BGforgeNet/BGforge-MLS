// creator  : aVENGER
// argument : RR#SCRL

BEGIN ~RR#SCRL~

    IF ~True()~ THEN BEGIN RR#SCRL00
        SAY @8222  // (Select a spell level:)
        IF ~PartyGoldGT(49)~ THEN REPLY @8230 GOTO RR#SCRL01  // 1st level spells (50 gp)
        IF ~PartyGoldGT(99)~ THEN REPLY @8231 GOTO RR#SCRL02  // 2nd level spells (100 gp)
        IF ~PartyGoldGT(149)~ THEN REPLY @8232 GOTO RR#SCRL03  // 3rd level spells (150 gp)
        IF ~PartyGoldGT(249)~ THEN REPLY @8233 GOTO RR#SCRL04  // 4th level spells (250 gp)
        IF ~PartyGoldGT(499)~ THEN REPLY @8234 GOTO RR#SCRL05  // 5th level spells (500 gp)
        IF ~PartyGoldGT(999)~ THEN REPLY @8235 GOTO RR#SCRL06  // 6th level spells (1000 gp)
        IF ~PartyGoldGT(1499)~ THEN REPLY @8236 GOTO RR#SCRL07  // 7th level spells (1500 gp)
        IF ~PartyGoldGT(2499)~ THEN REPLY @8237 GOTO RR#SCRL08  // 8th level spells (2500 gp)
        IF ~PartyGoldGT(4999)~ THEN REPLY @8238 GOTO RR#SCRL09  // 9th level spells (5000 gp)
        IF ~~ THEN REPLY @8250 EXIT  // (Do not scribe any scrolls.)
    END

    IF ~~ THEN BEGIN RR#SCRL01  // 1st level spells (50 gp)
        SAY @8260  // (Choose which spell to scribe onto a scroll.)
        IF ~HaveSpell(2101)~ THEN REPLY #12030 DO ~TakePartyGold(50) DestroyGold(50) RemoveSpell(2101) GiveItemCreate("SCRL66",Myself,1,1,1)~ EXIT  // Grease
        IF ~HaveSpell(2102)~ THEN REPLY #12031 DO ~TakePartyGold(50) DestroyGold(50) RemoveSpell(2102) GiveItemCreate("SCRL67",Myself,1,1,1)~ EXIT  // Armor
        IF ~HaveSpell(2103)~ THEN REPLY #12074 DO ~TakePartyGold(50) DestroyGold(50) RemoveSpell(2103) GiveItemCreate("SCRL68",Myself,1,1,1)~ EXIT  // Burning Hands
        IF ~HaveSpell(2104)~ THEN REPLY #12045 DO ~TakePartyGold(50) DestroyGold(50) RemoveSpell(2104) GiveItemCreate("SCRL69",Myself,1,1,1)~ EXIT  // Charm Person
        IF ~HaveSpell(2105)~ THEN REPLY #12075 DO ~TakePartyGold(50) DestroyGold(50) RemoveSpell(2105) GiveItemCreate("SCRL70",Myself,1,1,1)~ EXIT  // Color Spray
        IF ~HaveSpell(2106)~ THEN REPLY #12015 DO ~TakePartyGold(50) DestroyGold(50) RemoveSpell(2106) GiveItemCreate("SCRL71",Myself,1,1,1)~ EXIT  // Blindness
        IF ~HaveSpell(2107)~ THEN REPLY #12046 DO ~TakePartyGold(50) DestroyGold(50) RemoveSpell(2107) GiveItemCreate("SCRL72",Myself,1,1,1)~ EXIT  // Friends
        IF ~HaveSpell(2108)~ THEN REPLY #12024 DO ~TakePartyGold(50) DestroyGold(50) RemoveSpell(2108) GiveItemCreate("SCRL73",Myself,1,1,1)~ EXIT  // Protection From Petrification
        IF ~HaveSpell(2110)~ THEN REPLY #12040 DO ~TakePartyGold(50) DestroyGold(50) RemoveSpell(2110) GiveItemCreate("SCRL75",Myself,1,1,1)~ EXIT  // Identify
        IF ~HaveSpell(2111)~ THEN REPLY ~%InfravisionText%~ DO ~TakePartyGold(50) DestroyGold(50) RemoveSpell(2111) GiveItemCreate("SCRL76",Myself,1,1,1)~ EXIT  // Infravision
        IF ~HaveSpell(2112)~ THEN REPLY #12052 DO ~TakePartyGold(50) DestroyGold(50) RemoveSpell(2112) GiveItemCreate("SCRL77",Myself,1,1,1)~ EXIT  // Magic Missile
        IF ~HaveSpell(2113)~ THEN REPLY #12023 DO ~TakePartyGold(50) DestroyGold(50) RemoveSpell(2113) GiveItemCreate("SCRL78",Myself,1,1,1)~ EXIT  // Protection From Evil
        IF ~HaveSpell(2114)~ THEN REPLY #12053 DO ~TakePartyGold(50) DestroyGold(50) RemoveSpell(2114) GiveItemCreate("SCRL79",Myself,1,1,1)~ EXIT  // Shield
        IF ~HaveSpell(2115)~ THEN REPLY #12076 DO ~TakePartyGold(50) DestroyGold(50) RemoveSpell(2115) GiveItemCreate("SCRL80",Myself,1,1,1)~ EXIT  // Shocking Grasp
        IF ~HaveSpell(2116)~ THEN REPLY #12047 DO ~TakePartyGold(50) DestroyGold(50) RemoveSpell(2116) GiveItemCreate("SCRL81",Myself,1,1,1)~ EXIT  // Sleep
        IF ~HaveSpell(2117)~ THEN REPLY #12067 DO ~TakePartyGold(50) DestroyGold(50) RemoveSpell(2117) GiveItemCreate("SCRL82",Myself,1,1,1)~ EXIT  // Chill Touch
        IF ~HaveSpell(2118)~ THEN REPLY #12054 DO ~TakePartyGold(50) DestroyGold(50) RemoveSpell(2118) GiveItemCreate("SCRL83",Myself,1,1,1)~ EXIT  // Chromatic Orb
        IF ~HaveSpell(2119)~ THEN REPLY #12068 DO ~TakePartyGold(50) DestroyGold(50) RemoveSpell(2119) GiveItemCreate("SCRL84",Myself,1,1,1)~ EXIT  // Larloch's Minor Drain
        IF ~HaveSpell(2120)~ THEN REPLY #25866 DO ~TakePartyGold(50) DestroyGold(50) RemoveSpell(2120) GiveItemCreate("SCRL5U",Myself,1,1,1)~ EXIT  // Reflected Image
        IF ~HaveSpell(2123)~ THEN REPLY #8072 DO ~TakePartyGold(50) DestroyGold(50) RemoveSpell(2123) GiveItemCreate("SCRL6D",Myself,1,1,1)~ EXIT  // Find Familiar
        IF ~HaveSpell(2125)~ THEN REPLY #38586 DO ~TakePartyGold(50) DestroyGold(50) RemoveSpell(2125) GiveItemCreate("SCRLA6",Myself,1,1,1)~ EXIT  // Spook
        IF ~~ THEN REPLY @8261 GOTO RR#SCRL00  // Select a different spell level
    END

    IF ~~ THEN BEGIN RR#SCRL02  // 2nd level spells (100 gp)
        SAY @8260  // (Choose which spell to scribe onto a scroll.)
        IF ~HaveSpell(2201)~ THEN REPLY #12016 DO ~TakePartyGold(100) DestroyGold(100) RemoveSpell(2201) GiveItemCreate("SCRL85",Myself,1,1,1)~ EXIT  // Blur
        IF ~HaveSpell(2202)~ THEN REPLY #12041 DO ~TakePartyGold(100) DestroyGold(100) RemoveSpell(2202) GiveItemCreate("SCRL86",Myself,1,1,1)~ EXIT  // Detect Evil
        IF ~HaveSpell(2203)~ THEN REPLY #12042 DO ~TakePartyGold(100) DestroyGold(100) RemoveSpell(2203) GiveItemCreate("SCRL87",Myself,1,1,1)~ EXIT  // Detect Invisibilty
        IF ~HaveSpell(2205)~ THEN REPLY #12069 DO ~TakePartyGold(100) DestroyGold(100) RemoveSpell(2205) GiveItemCreate("SCRL89",Myself,1,1,1)~ EXIT  // Horror
        IF ~HaveSpell(2206)~ THEN REPLY #12017 DO ~TakePartyGold(100) DestroyGold(100) RemoveSpell(2206) GiveItemCreate("SCRL90",Myself,1,1,1)~ EXIT  // Invisibilty
        IF ~HaveSpell(2207)~ THEN REPLY #12131 DO ~TakePartyGold(100) DestroyGold(100) RemoveSpell(2207) GiveItemCreate("SCRL91",Myself,1,1,1)~ EXIT  // Knock
        IF ~HaveSpell(2208)~ THEN REPLY ~%KnowAlignmentText%~ DO ~TakePartyGold(100) DestroyGold(100) RemoveSpell(2208) GiveItemCreate("SCRL92",Myself,1,1,1)~ EXIT  // Know Alignment
        IF ~HaveSpell(2209)~ THEN REPLY #12048 DO ~TakePartyGold(100) DestroyGold(100) RemoveSpell(2209) GiveItemCreate("SCRL93",Myself,1,1,1)~ EXIT  // Luck
        IF ~HaveSpell(2210)~ THEN REPLY #12025 DO ~TakePartyGold(100) DestroyGold(100) RemoveSpell(2210) GiveItemCreate("SCRL94",Myself,1,1,1)~ EXIT  // Resist Fear
        IF ~HaveSpell(2211)~ THEN REPLY #12033 DO ~TakePartyGold(100) DestroyGold(100) RemoveSpell(2211) GiveItemCreate("SCRL95",Myself,1,1,1)~ EXIT  // Melf's Acid Arrow
        IF ~HaveSpell(2212)~ THEN REPLY #12018 DO ~TakePartyGold(100) DestroyGold(100) RemoveSpell(2212) GiveItemCreate("SCRL96",Myself,1,1,1)~ EXIT  // Mirror Image
        IF ~HaveSpell(2213)~ THEN REPLY #12056 DO ~TakePartyGold(100) DestroyGold(100) RemoveSpell(2213) GiveItemCreate("SCRL97",Myself,1,1,1)~ EXIT  // Stinking Cloud
        IF ~HaveSpell(2214)~ THEN REPLY #12077 DO ~TakePartyGold(100) DestroyGold(100) RemoveSpell(2214) GiveItemCreate("SCRL98",Myself,1,1,1)~ EXIT  // Strength
        IF ~HaveSpell(2215)~ THEN REPLY #12057 DO ~TakePartyGold(100) DestroyGold(100) RemoveSpell(2215) GiveItemCreate("SCRL99",Myself,1,1,1)~ EXIT  // Web
        IF ~HaveSpell(2217)~ THEN REPLY #12058 DO ~TakePartyGold(100) DestroyGold(100) RemoveSpell(2217) GiveItemCreate("SCRL1B",Myself,1,1,1)~ EXIT  // Agannazar's Scorcher
        IF ~HaveSpell(2218)~ THEN REPLY #12070 DO ~TakePartyGold(100) DestroyGold(100) RemoveSpell(2218) GiveItemCreate("SCRL1C",Myself,1,1,1)~ EXIT  // Ghoul Touch
        IF ~HaveSpell(2219)~ THEN REPLY #12079 DO ~TakePartyGold(100) DestroyGold(100) RemoveSpell(2219) GiveItemCreate("SCRL3G",Myself,1,1,1)~ EXIT  // Vocalize
        IF ~HaveSpell(2220)~ THEN REPLY #7480 DO ~TakePartyGold(100) DestroyGold(100) RemoveSpell(2220) GiveItemCreate("SCRL6E",Myself,1,1,1)~ EXIT  // Power Word Sleep
        IF ~HaveSpell(2221)~ THEN REPLY #7725 DO ~TakePartyGold(100) DestroyGold(100) RemoveSpell(2221) GiveItemCreate("SCRL6F",Myself,1,1,1)~ EXIT  // Ray of Enfeeblement
        IF ~HaveSpell(2223)~ THEN REPLY #38592 DO ~TakePartyGold(100) DestroyGold(100) RemoveSpell(2223) GiveItemCreate("SCRLA2",Myself,1,1,1)~ EXIT  // Deafness
        IF ~HaveSpell(2224)~ THEN REPLY #38594 DO ~TakePartyGold(100) DestroyGold(100) RemoveSpell(2224) GiveItemCreate("SCRLA3",Myself,1,1,1)~ EXIT  // Glitterdust
        IF ~~ THEN REPLY @8261 GOTO RR#SCRL00  // Select a different spell level
    END

    IF ~~ THEN BEGIN RR#SCRL03  // 3rd level spells (150 gp)
        SAY @8260  // (Choose which spell to scribe onto a scroll.)
        IF ~HaveSpell(2301)~ THEN REPLY #12044 DO ~TakePartyGold(150) DestroyGold(150) RemoveSpell(2301) GiveItemCreate("SCRL1D",Myself,1,1,1)~ EXIT  // Clairvoyance
        IF ~HaveSpell(2302)~ THEN REPLY #39853 DO ~TakePartyGold(150) DestroyGold(150) RemoveSpell(2302) GiveItemCreate("SCRLA7",Myself,1,1,1)~ EXIT  // Remove Magic
        IF ~HaveSpell(2303)~ THEN REPLY #12034 DO ~TakePartyGold(150) DestroyGold(150) RemoveSpell(2303) GiveItemCreate("SCRL1F",Myself,1,1,1)~ EXIT  // Flame Arrow
        IF ~HaveSpell(2304)~ THEN REPLY #6618 DO ~TakePartyGold(150) DestroyGold(150) RemoveSpell(2304) GiveItemCreate("SCRL1G",Myself,1,1,1)~ EXIT  // Fireball
        IF ~HaveSpell(2305)~ THEN REPLY #12080 DO ~TakePartyGold(150) DestroyGold(150) RemoveSpell(2305) GiveItemCreate("SCRL1H",Myself,1,1,1)~ EXIT  // Haste
        IF ~HaveSpell(2306)~ THEN REPLY #12049 DO ~TakePartyGold(150) DestroyGold(150) RemoveSpell(2306) GiveItemCreate("SCRL1I",Myself,1,1,1)~ EXIT  // Hold Person
        IF ~HaveSpell(2307)~ THEN REPLY #12019 DO ~TakePartyGold(150) DestroyGold(150) RemoveSpell(2307) GiveItemCreate("SCRL1J",Myself,1,1,1)~ EXIT  // Invisibility 10' Radius
        IF ~HaveSpell(2308)~ THEN REPLY #12060 DO ~TakePartyGold(150) DestroyGold(150) RemoveSpell(2308) GiveItemCreate("SCRL1K",Myself,1,1,1)~ EXIT  // Lightning Bolt
        IF ~HaveSpell(2309)~ THEN REPLY #12035 DO ~TakePartyGold(150) DestroyGold(150) RemoveSpell(2309) GiveItemCreate("SCRL1L",Myself,1,1,1)~ EXIT  // Monster Summoning I
        IF ~HaveSpell(2310)~ THEN REPLY #12027 DO ~TakePartyGold(150) DestroyGold(150) RemoveSpell(2310) GiveItemCreate("SCRL1M",Myself,1,1,1)~ EXIT  // Non-Detection
        IF ~HaveSpell(2311)~ THEN REPLY #12028 DO ~TakePartyGold(150) DestroyGold(150) RemoveSpell(2311) GiveItemCreate("SCRL1N",Myself,1,1,1)~ EXIT  // Protection From Normal Missiles
        IF ~HaveSpell(2312)~ THEN REPLY #12081 DO ~TakePartyGold(150) DestroyGold(150) RemoveSpell(2312) GiveItemCreate("SCRL1O",Myself,1,1,1)~ EXIT  // Slow
        IF ~HaveSpell(2313)~ THEN REPLY #12072 DO ~TakePartyGold(150) DestroyGold(150) RemoveSpell(2313) GiveItemCreate("SCRL1P",Myself,1,1,1)~ EXIT  // Skull Trap
        IF ~HaveSpell(2314)~ THEN REPLY #12071 DO ~TakePartyGold(150) DestroyGold(150) RemoveSpell(2314) GiveItemCreate("SCRL1Q",Myself,1,1,1)~ EXIT  // Vampiric Touch
        IF ~HaveSpell(2316)~ THEN REPLY #12050 DO ~TakePartyGold(150) DestroyGold(150) RemoveSpell(2316) GiveItemCreate("SCRL1S",Myself,1,1,1)~ EXIT  // Dire Charm
        IF ~HaveSpell(2317)~ THEN REPLY #12129 DO ~TakePartyGold(150) DestroyGold(150) RemoveSpell(2317) GiveItemCreate("SCRL1T",Myself,1,1,1)~ EXIT  // Ghost Armor
        IF ~HaveSpell(2318)~ THEN REPLY #10861 DO ~TakePartyGold(150) DestroyGold(150) RemoveSpell(2318) GiveItemCreate("SCRL6G",Myself,1,1,1)~ EXIT  // Minor Spell Deflection
        IF ~HaveSpell(2321)~ THEN REPLY #25873 DO ~TakePartyGold(150) DestroyGold(150) RemoveSpell(2321) GiveItemCreate("SCRL6J",Myself,1,1,1)~ EXIT  // Spell Thrust
        IF ~HaveSpell(2322)~ THEN REPLY #25871 DO ~TakePartyGold(150) DestroyGold(150) RemoveSpell(2322) GiveItemCreate("SCRL6K",Myself,1,1,1)~ EXIT  // Detect Illusion
        IF ~HaveSpell(2324)~ THEN REPLY #32379 DO ~TakePartyGold(150) DestroyGold(150) RemoveSpell(2324) GiveItemCreate("SCRL6L",Myself,1,1,1)~ EXIT  // Hold Undead
        IF ~HaveSpell(2325)~ THEN REPLY #38588 DO ~TakePartyGold(150) DestroyGold(150) RemoveSpell(2325) GiveItemCreate("SCRLA5",Myself,1,1,1)~ EXIT  // Melf's Minute Meteor
        IF ~HaveSpell(2326)~ THEN REPLY #12026 DO ~TakePartyGold(150) DestroyGold(150) RemoveSpell(2326) GiveItemCreate("SCRL1E",Myself,1,1,1)~ EXIT  // Dispel Magic
        IF ~~ THEN REPLY @8261 GOTO RR#SCRL00  // Select a different spell level
    END

    IF ~~ THEN BEGIN RR#SCRL04  // 4th level spells (250 gp)
        SAY @8260  // (Choose which spell to scribe onto a scroll.)
        IF ~HaveSpell(2401)~ THEN REPLY #12051 DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2401) GiveItemCreate("SCRL1U",Myself,1,1,1)~ EXIT  // Confusion
        IF ~HaveSpell(2403)~ THEN REPLY #12061 DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2403) GiveItemCreate("SCRL1W",Myself,1,1,1)~ EXIT  // Fireshield (Blue)
        IF ~HaveSpell(2404)~ THEN REPLY #12062 DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2404) GiveItemCreate("SCRL1X",Myself,1,1,1)~ EXIT  // Ice Storm
        IF ~HaveSpell(2405)~ THEN REPLY #12021 DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2405) GiveItemCreate("SCRL1Y",Myself,1,1,1)~ EXIT  // Improved Invisibility
        IF ~HaveSpell(2406)~ THEN REPLY #12029 DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2406) GiveItemCreate("SCRL1Z",Myself,1,1,1)~ EXIT  // Minor Globe of Invulnerability
        IF ~HaveSpell(2407)~ THEN REPLY #12037 DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2407) GiveItemCreate("SCRL2A",Myself,1,1,1)~ EXIT  // Monster Summoning II
        IF ~HaveSpell(2408)~ THEN REPLY #25875 DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2408) GiveItemCreate("SCRL2B",Myself,1,1,1)~ EXIT  // Stoneskin
        IF ~HaveSpell(2409)~ THEN REPLY #38590 DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2409) GiveItemCreate("SCRLA8",Myself,1,1,1)~ EXIT  // Contagion
        IF ~HaveSpell(2410)~ THEN REPLY ~%RemoveCurseText%~ DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2410) GiveItemCreate("SCRL5G",Myself,1,1,1)~ EXIT  // Remove Curse
        IF ~HaveSpell(2411)~ THEN REPLY #22173 DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2411) GiveItemCreate("SCRL5H",Myself,1,1,1)~ EXIT  // Emotion
        IF ~HaveSpell(2412)~ THEN REPLY #22185 DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2412) GiveItemCreate("SCRL5I",Myself,1,1,1)~ EXIT  // Greater Malison
        IF ~HaveSpell(2413)~ THEN REPLY #22177 DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2413) GiveItemCreate("SCRL5J",Myself,1,1,1)~ EXIT  // Oliluke's Resilient Sphere
        IF ~HaveSpell(2414)~ THEN REPLY #22608 DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2414) GiveItemCreate("SCRL5K",Myself,1,1,1)~ EXIT  // Spirit Armor
        IF ~HaveSpell(2415)~ THEN REPLY #20963 DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2415) GiveItemCreate("SCRL5L",Myself,1,1,1)~ EXIT  // Polymorph Other
        IF ~HaveSpell(2416)~ THEN REPLY #22316 DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2416) GiveItemCreate("SCRL5M",Myself,1,1,1)~ EXIT  // Polymorph Self
        IF ~HaveSpell(2417)~ THEN REPLY #25904 DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2417) GiveItemCreate("SCRL6M",Myself,1,1,1)~ EXIT  // Enchanted Weapon
        IF ~HaveSpell(2418)~ THEN REPLY #25880 DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2418) GiveItemCreate("SCRL6N",Myself,1,1,1)~ EXIT  // Fireshield (Red)
        IF ~HaveSpell(2419)~ THEN REPLY #25884 DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2419) GiveItemCreate("SCRL6O",Myself,1,1,1)~ EXIT  // Secret Word
        IF ~HaveSpell(2420)~ THEN REPLY #25889 DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2420) GiveItemCreate("SCRL6P",Myself,1,1,1)~ EXIT  // Minor Sequencer
        IF ~HaveSpell(2421)~ THEN REPLY #25892 DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2421) GiveItemCreate("SCRL6Q",Myself,1,1,1)~ EXIT  // Teleport Field
        IF ~HaveSpell(2423)~ THEN REPLY #29207 DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2423) GiveItemCreate("SCRL6R",Myself,1,1,1)~ EXIT  // Spider Spawn
        IF ~HaveSpell(2424)~ THEN REPLY #38133 DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2424) GiveItemCreate("SCRLAJ",Myself,1,1,1)~ EXIT  // Farsight
        IF ~HaveSpell(2425)~ THEN REPLY #38596 DO ~TakePartyGold(250) DestroyGold(250) RemoveSpell(2425) GiveItemCreate("SCRLA1",Myself,1,1,1)~ EXIT  // Wizard Eye
        IF ~~ THEN REPLY @8261 GOTO RR#SCRL00  // Select a different spell level
    END

    IF ~~ THEN BEGIN RR#SCRL05  // 5th level spells (500 gp)
        SAY @8260  // (Choose which spell to scribe onto a scroll.)
        IF ~HaveSpell(2501)~ THEN REPLY ~%AnimateDeadText%~ DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2501) GiveItemCreate("SCRL2D",Myself,1,1,1)~ EXIT  // Animate Dead
        IF ~HaveSpell(2502)~ THEN REPLY #12065 DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2502) GiveItemCreate("SCRL2E",Myself,1,1,1)~ EXIT  // Cloudkill
        IF ~HaveSpell(2503)~ THEN REPLY #12066 DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2503) GiveItemCreate("SCRL2F",Myself,1,1,1)~ EXIT  // Cone of Cold
        IF ~HaveSpell(2504)~ THEN REPLY #12038 DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2504) GiveItemCreate("SCRL2G",Myself,1,1,1)~ EXIT  // Monster Summoning III
        IF ~HaveSpell(2505)~ THEN REPLY #12022 DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2505) GiveItemCreate("SCRL2H",Myself,1,1,1)~ EXIT  // Shadow Door
        IF ~HaveSpell(2506)~ THEN REPLY #22614 DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2506) GiveItemCreate("SCRL5N",Myself,1,1,1)~ EXIT  // Domination
        IF ~HaveSpell(2507)~ THEN REPLY #22616 DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2507) GiveItemCreate("SCRL5O",Myself,1,1,1)~ EXIT  // Hold Monster
        IF ~HaveSpell(2508)~ THEN REPLY #22610 DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2508) GiveItemCreate("SCRL5P",Myself,1,1,1)~ EXIT  // Chaos
        IF ~HaveSpell(2509)~ THEN REPLY #22612 DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2509) GiveItemCreate("SCRL5Q",Myself,1,1,1)~ EXIT  // Feeblemind
        IF ~HaveSpell(2510)~ THEN REPLY #25912 DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2510) GiveItemCreate("SCRL6S",Myself,1,1,1)~ EXIT  // Spell Immunity
        IF ~HaveSpell(2511)~ THEN REPLY #7606 DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2511) GiveItemCreate("SCRL6T",Myself,1,1,1)~ EXIT  // Protection From Normal Weapons
        IF ~HaveSpell(2512)~ THEN REPLY #7571 DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2512) GiveItemCreate("SCRL5T",Myself,1,1,1)~ EXIT  // Protection from Electricity
        IF ~HaveSpell(2513)~ THEN REPLY #25914 DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2513) GiveItemCreate("SCRL6U",Myself,1,1,1)~ EXIT  // Breach
        IF ~HaveSpell(2514)~ THEN REPLY #16963 DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2514) GiveItemCreate("SCRL6V",Myself,1,1,1)~ EXIT  // Lower Resistance
        IF ~HaveSpell(2515)~ THEN REPLY #25927 DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2515) GiveItemCreate("SCRL6W",Myself,1,1,1)~ EXIT  // Oracle
        IF ~HaveSpell(2516)~ THEN REPLY #24830 DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2516) GiveItemCreate("SCRL6X",Myself,1,1,1)~ EXIT  // Conjure Lesser Fire Elemental
        IF ~HaveSpell(2517)~ THEN REPLY #7563 DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2517) GiveItemCreate("SCRL6Y",Myself,1,1,1)~ EXIT  // Protection from Acid
        IF ~HaveSpell(2518)~ THEN REPLY #7787 DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2518) GiveItemCreate("SCRL6Z",Myself,1,1,1)~ EXIT  // Phantom Blade
        IF ~HaveSpell(2519)~ THEN REPLY #26228 DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2519) GiveItemCreate("SCRL8X",Myself,1,1,1)~ EXIT  // Spell Shield
        IF ~HaveSpell(2520)~ THEN REPLY #24827 DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2520) GiveItemCreate("SCRL7B",Myself,1,1,1)~ EXIT  // Conjure Lesser Air Elemental
        IF ~HaveSpell(2521)~ THEN REPLY #24829 DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2521) GiveItemCreate("SCRL7C",Myself,1,1,1)~ EXIT  // Conjure Lesser Earth Elemental
        IF ~HaveSpell(2522)~ THEN REPLY #10850 DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2522) GiveItemCreate("SCRL7D",Myself,1,1,1)~ EXIT  // Minor Spell Turning
        IF ~HaveSpell(2523)~ THEN REPLY #39964 DO ~TakePartyGold(500) DestroyGold(500) RemoveSpell(2523) GiveItemCreate("SCRLAL",Myself,1,1,1)~ EXIT  // Sunfire
        IF ~~ THEN REPLY @8261 GOTO RR#SCRL00  // Select a different spell level
    END

    IF ~~ THEN BEGIN RR#SCRL06  // 6th level spells (1000 gp)
        SAY @8260  // (Choose which spell to scribe onto a scroll.)
        IF ~HaveSpell(2601)~ THEN REPLY #23790 DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2601) GiveItemCreate("SCRL7E",Myself,1,1,1)~ EXIT  // Invisible Stalker
        IF ~HaveSpell(2602)~ THEN REPLY #23791 DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2602) GiveItemCreate("SCRL7F",Myself,1,1,1)~ EXIT  // Globe of Invunerability
        IF ~HaveSpell(2603)~ THEN REPLY #23792 DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2603) GiveItemCreate("SCRL7G",Myself,1,1,1)~ EXIT  // Tenser's Transformation
        IF ~HaveSpell(2604)~ THEN REPLY #23793 DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2604) GiveItemCreate("SCRL7H",Myself,1,1,1)~ EXIT  // Flesh to Stone
        IF ~HaveSpell(2605)~ THEN REPLY #7917 DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2605) GiveItemCreate("SCRL7I",Myself,1,1,1)~ EXIT  // Death Spell
        IF ~HaveSpell(2606)~ THEN REPLY #7930 DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2606) GiveItemCreate("SCRL7J",Myself,1,1,1)~ EXIT  // Protection From Magic Energy
        IF ~HaveSpell(2607)~ THEN REPLY #25930 DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2607) GiveItemCreate("SCRL7K",Myself,1,1,1)~ EXIT  // Mislead
        IF ~HaveSpell(2608)~ THEN REPLY #25934 DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2608) GiveItemCreate("SCRL7L",Myself,1,1,1)~ EXIT  // Pierce Magic
        IF ~HaveSpell(2609)~ THEN REPLY #25633 DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2609) GiveItemCreate("SCRL7M",Myself,1,1,1)~ EXIT  // True Sight
        IF ~HaveSpell(2611)~ THEN REPLY #7610 DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2611) GiveItemCreate("SCRL7O",Myself,1,1,1)~ EXIT  // Protection From Magic Weapons
        IF ~HaveSpell(2612)~ THEN REPLY #7778 DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2612) GiveItemCreate("SCRL7P",Myself,1,1,1)~ EXIT  // Power Word Silence
        IF ~HaveSpell(2613)~ THEN REPLY #25937 DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2613) GiveItemCreate("SCRL7Q",Myself,1,1,1)~ EXIT  // Improved Haste
        IF ~HaveSpell(2614)~ THEN REPLY ~%DeathFogText%~ DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2614) GiveItemCreate("SCRL7R",Myself,1,1,1)~ EXIT  // Death Fog
        IF ~HaveSpell(2615)~ THEN REPLY #25939 DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2615) GiveItemCreate("SCRL7S",Myself,1,1,1)~ EXIT  // Chain Lightning
        IF ~HaveSpell(2616)~ THEN REPLY #2628 DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2616) GiveItemCreate("SCRL7T",Myself,1,1,1)~ EXIT  // Disintegrate
        IF ~HaveSpell(2617)~ THEN REPLY #25942 DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2617) GiveItemCreate("SCRL7U",Myself,1,1,1)~ EXIT  // Contingency
        IF ~HaveSpell(2618)~ THEN REPLY #10888 DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2618) GiveItemCreate("SCRL7V",Myself,1,1,1)~ EXIT  // Spell Deflection
        IF ~HaveSpell(2619)~ THEN REPLY #24785 DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2619) GiveItemCreate("SCRL7W",Myself,1,1,1)~ EXIT  // Wyvern Call
        IF ~HaveSpell(2620)~ THEN REPLY #15211 DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2620) GiveItemCreate("SCRL7X",Myself,1,1,1)~ EXIT  // Conjure Fire Elemental
        IF ~HaveSpell(2621)~ THEN REPLY #24839 DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2621) GiveItemCreate("SCRL7Y",Myself,1,1,1)~ EXIT  // Conjure Air Elemental
        IF ~HaveSpell(2622)~ THEN REPLY #15180 DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2622) GiveItemCreate("SCRL7Z",Myself,1,1,1)~ EXIT  // Conjure Earth Elemental
        IF ~HaveSpell(2623)~ THEN REPLY ~%CarrionText%~ DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2623) GiveItemCreate("SCRL8A",Myself,1,1,1)~ EXIT  // Carrion Summons
        IF ~HaveSpell(2624)~ THEN REPLY #29213 DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2624) GiveItemCreate("SCRL8B",Myself,1,1,1)~ EXIT  // Summon Nishru
        IF ~HaveSpell(2625)~ THEN REPLY #32393 DO ~TakePartyGold(1000) DestroyGold(1000) RemoveSpell(2625) GiveItemCreate("SCRL8C",Myself,1,1,1)~ EXIT  // Stone to Flesh
        IF ~~ THEN REPLY @8261 GOTO RR#SCRL00  // Select a different spell level
    END

    IF ~~ THEN BEGIN RR#SCRL07  // 7th level spells (1500 gp)
        SAY @8260  // (Choose which spell to scribe onto a scroll.)
        IF ~HaveSpell(2701)~ THEN REPLY #10871 DO ~TakePartyGold(1500) DestroyGold(1500) RemoveSpell(2701) GiveItemCreate("SCRL8D",Myself,1,1,1)~ EXIT  // Spell Turning
        IF ~HaveSpell(2702)~ THEN REPLY #7598 DO ~TakePartyGold(1500) DestroyGold(1500) RemoveSpell(2702) GiveItemCreate("SCRL8E",Myself,1,1,1)~ EXIT  // Protection From The Elements
        IF ~HaveSpell(2703)~ THEN REPLY #25944 DO ~TakePartyGold(1500) DestroyGold(1500) RemoveSpell(2703) GiveItemCreate("SCRL8F",Myself,1,1,1)~ EXIT  // Project Image
        IF ~HaveSpell(2704)~ THEN REPLY #15465 DO ~TakePartyGold(1500) DestroyGold(1500) RemoveSpell(2704) GiveItemCreate("SCRL8G",Myself,1,1,1)~ EXIT  // Ruby Ray of Reversal
        IF ~HaveSpell(2705)~ THEN REPLY #25947 DO ~TakePartyGold(1500) DestroyGold(1500) RemoveSpell(2705) GiveItemCreate("SCRL8H",Myself,1,1,1)~ EXIT  // Warding Whip
        IF ~HaveSpell(2707)~ THEN REPLY ~%CacofiendText%~ DO ~TakePartyGold(1500) DestroyGold(1500) RemoveSpell(2707) GiveItemCreate("SCRL8I",Myself,1,1,1)~ EXIT  // Cacofiend
        IF ~HaveSpell(2708)~ THEN REPLY #7612 DO ~TakePartyGold(1500) DestroyGold(1500) RemoveSpell(2708) GiveItemCreate("SCRL8J",Myself,1,1,1)~ EXIT  // Mantle
        IF ~HaveSpell(2710)~ THEN REPLY #25951 DO ~TakePartyGold(1500) DestroyGold(1500) RemoveSpell(2710) GiveItemCreate("SCRL8L",Myself,1,1,1)~ EXIT  // Spell Sequencer
        IF ~HaveSpell(2711)~ THEN REPLY #25953 DO ~TakePartyGold(1500) DestroyGold(1500) RemoveSpell(2711) GiveItemCreate("SCRL8M",Myself,1,1,1)~ EXIT  // Sphere of Chaos
        IF ~HaveSpell(2712)~ THEN REPLY #25958 DO ~TakePartyGold(1500) DestroyGold(1500) RemoveSpell(2712) GiveItemCreate("SCRL8N",Myself,1,1,1)~ EXIT  // Delayed Blast Fireball
        IF ~HaveSpell(2713)~ THEN REPLY #7665 DO ~TakePartyGold(1500) DestroyGold(1500) RemoveSpell(2713) GiveItemCreate("SCRL8O",Myself,1,1,1)~ EXIT  // Finger of Death
        IF ~HaveSpell(2714)~ THEN REPLY #25960 DO ~TakePartyGold(1500) DestroyGold(1500) RemoveSpell(2714) GiveItemCreate("SCRL8P",Myself,1,1,1)~ EXIT  // Prismatic Spray
        IF ~HaveSpell(2715)~ THEN REPLY #22143 DO ~TakePartyGold(1500) DestroyGold(1500) RemoveSpell(2715) GiveItemCreate("SCRL8Q",Myself,1,1,1)~ EXIT  // Power Word Stun
        IF ~HaveSpell(2716)~ THEN REPLY #7831 DO ~TakePartyGold(1500) DestroyGold(1500) RemoveSpell(2716) GiveItemCreate("SCRL8R",Myself,1,1,1)~ EXIT  // Mordenkainen's Sword
        IF ~HaveSpell(2717)~ THEN REPLY #29215 DO ~TakePartyGold(1500) DestroyGold(1500) RemoveSpell(2717) GiveItemCreate("SCRL8S",Myself,1,1,1)~ EXIT  // Summon Efreet
        IF ~HaveSpell(2718)~ THEN REPLY #29217 DO ~TakePartyGold(1500) DestroyGold(1500) RemoveSpell(2718) GiveItemCreate("SCRL8T",Myself,1,1,1)~ EXIT  // Summon Djinni
        IF ~HaveSpell(2719)~ THEN REPLY #29219 DO ~TakePartyGold(1500) DestroyGold(1500) RemoveSpell(2719) GiveItemCreate("SCRL8U",Myself,1,1,1)~ EXIT  // Summon Hakeashar
        IF ~HaveSpell(2720)~ THEN REPLY #32409 DO ~TakePartyGold(1500) DestroyGold(1500) RemoveSpell(2720) GiveItemCreate("SCRL8V",Myself,1,1,1)~ EXIT  // Control Undead
        IF ~HaveSpell(2721)~ THEN REPLY #32427 DO ~TakePartyGold(1500) DestroyGold(1500) RemoveSpell(2721) GiveItemCreate("SCRL8W",Myself,1,1,1)~ EXIT  // Mass Invisibility
        IF ~HaveSpell(2722)~ THEN REPLY #38598 DO ~TakePartyGold(1500) DestroyGold(1500) RemoveSpell(2722) GiveItemCreate("SCRLA4",Myself,1,1,1)~ EXIT  // Limited Wish
        IF ~~ THEN REPLY @8261 GOTO RR#SCRL00  // Select a different spell level
    END

    IF ~~ THEN BEGIN RR#SCRL08  // 8th level spells (2500 gp)
        SAY @8260  // (Choose which spell to scribe onto a scroll.)
        IF ~HaveSpell(2803)~ THEN REPLY #7600 DO ~TakePartyGold(2500) DestroyGold(2500) RemoveSpell(2803) GiveItemCreate("SCRL8Y",Myself,1,1,1)~ EXIT  // Protection From Energy
        IF ~HaveSpell(2804)~ THEN REPLY #26234 DO ~TakePartyGold(2500) DestroyGold(2500) RemoveSpell(2804) GiveItemCreate("SCRL8Z",Myself,1,1,1)~ EXIT  // Simulacrum
        IF ~HaveSpell(2805)~ THEN REPLY #26240 DO ~TakePartyGold(2500) DestroyGold(2500) RemoveSpell(2805) GiveItemCreate("SCRL9A",Myself,1,1,1)~ EXIT  // Pierce Shield
        IF ~HaveSpell(2807)~ THEN REPLY #17360 DO ~TakePartyGold(2500) DestroyGold(2500) RemoveSpell(2807) GiveItemCreate("SCRL9B",Myself,1,1,1)~ EXIT  // Summon Fiend
        IF ~HaveSpell(2808)~ THEN REPLY #7617 DO ~TakePartyGold(2500) DestroyGold(2500) RemoveSpell(2808) GiveItemCreate("SCRL9C",Myself,1,1,1)~ EXIT  // Improved Mantle
        IF ~HaveSpell(2809)~ THEN REPLY #26243 DO ~TakePartyGold(2500) DestroyGold(2500) RemoveSpell(2809) GiveItemCreate("SCRL9D",Myself,1,1,1)~ EXIT  // Spell Trigger
        IF ~HaveSpell(2810)~ THEN REPLY #7663 DO ~TakePartyGold(2500) DestroyGold(2500) RemoveSpell(2810) GiveItemCreate("SCRL9E",Myself,1,1,1)~ EXIT  // Incendiary Cloud
        IF ~HaveSpell(2811)~ THEN REPLY #22145 DO ~TakePartyGold(2500) DestroyGold(2500) RemoveSpell(2811) GiveItemCreate("SCRL9F",Myself,1,1,1)~ EXIT  // Symbol Fear
        IF ~HaveSpell(2812)~ THEN REPLY #7679 DO ~TakePartyGold(2500) DestroyGold(2500) RemoveSpell(2812) GiveItemCreate("SCRL9G",Myself,1,1,1)~ EXIT  // Abi Dalzim's Horrid Wilting
        IF ~HaveSpell(2813)~ THEN REPLY #18141 DO ~TakePartyGold(2500) DestroyGold(2500) RemoveSpell(2813) GiveItemCreate("SCRL9H",Myself,1,1,1)~ EXIT  // Maze
        IF ~HaveSpell(2815)~ THEN REPLY #7783 DO ~TakePartyGold(2500) DestroyGold(2500) RemoveSpell(2815) GiveItemCreate("SCRL9J",Myself,1,1,1)~ EXIT  // Power Word Blind
        IF ~HaveSpell(2816)~ THEN REPLY #39956 DO ~TakePartyGold(2500) DestroyGold(2500) RemoveSpell(2816) GiveItemCreate("SCRLAP",Myself,1,1,1)~ EXIT  // Symbol Stun
        IF ~HaveSpell(2817)~ THEN REPLY #39966 DO ~TakePartyGold(2500) DestroyGold(2500) RemoveSpell(2817) GiveItemCreate("SCRLAO",Myself,1,1,1)~ EXIT  // Symbol Death
        IF ~HaveSpell(2818)~ THEN REPLY #63097 DO ~TakePartyGold(2500) DestroyGold(2500) RemoveSpell(2818) GiveItemCreate("SCRLB1",Myself,1,1,1)~ EXIT  // Bigby's Clenched Fist
        IF ~~ THEN REPLY @8261 GOTO RR#SCRL00  // Select a different spell level
    END

    IF ~~ THEN BEGIN RR#SCRL09  // 9th level spells (5000 gp)
        SAY @8260  // (Choose which spell to scribe onto a scroll.)
        IF ~HaveSpell(2902)~ THEN REPLY #26304 DO ~TakePartyGold(5000) DestroyGold(5000) RemoveSpell(2902) GiveItemCreate("SCRL9L",Myself,1,1,1)~ EXIT  // Spell Trap
        IF ~HaveSpell(2903)~ THEN REPLY #26314 DO ~TakePartyGold(5000) DestroyGold(5000) RemoveSpell(2903) GiveItemCreate("SCRL9M",Myself,1,1,1)~ EXIT  // Spellstrike
        IF ~HaveSpell(2905)~ THEN REPLY #14260 DO ~TakePartyGold(5000) DestroyGold(5000) RemoveSpell(2905) GiveItemCreate("SCRL9N",Myself,1,1,1)~ EXIT  // Gate
        IF ~HaveSpell(2907)~ THEN REPLY #7619 DO ~TakePartyGold(5000) DestroyGold(5000) RemoveSpell(2907) GiveItemCreate("SCRL9P",Myself,1,1,1)~ EXIT  // Absolute Immunity
        IF ~HaveSpell(2908)~ THEN REPLY #26328 DO ~TakePartyGold(5000) DestroyGold(5000) RemoveSpell(2908) GiveItemCreate("SCRL9Q",Myself,1,1,1)~ EXIT  // Chain Contingency
        IF ~HaveSpell(2909)~ THEN REPLY #26332 DO ~TakePartyGold(5000) DestroyGold(5000) RemoveSpell(2909) GiveItemCreate("SCRL9R",Myself,1,1,1)~ EXIT  // Time Stop
        IF ~HaveSpell(2910)~ THEN REPLY #16946 DO ~TakePartyGold(5000) DestroyGold(5000) RemoveSpell(2910) GiveItemCreate("SCRL9S",Myself,1,1,1)~ EXIT  // Imprisonment
        IF ~HaveSpell(2911)~ THEN REPLY #26345 DO ~TakePartyGold(5000) DestroyGold(5000) RemoveSpell(2911) GiveItemCreate("SCRL9T",Myself,1,1,1)~ EXIT  // Meteor Swarm
        IF ~HaveSpell(2912)~ THEN REPLY #22142 DO ~TakePartyGold(5000) DestroyGold(5000) RemoveSpell(2912) GiveItemCreate("SCRL9U",Myself,1,1,1)~ EXIT  // Power Word Kill
        IF ~HaveSpell(2913)~ THEN REPLY #7710 DO ~TakePartyGold(5000) DestroyGold(5000) RemoveSpell(2913) GiveItemCreate("SCRL9V",Myself,1,1,1)~ EXIT  // Wail of the Banshee
        IF ~HaveSpell(2914)~ THEN REPLY #23358 DO ~TakePartyGold(5000) DestroyGold(5000) RemoveSpell(2914) GiveItemCreate("SCRL9W",Myself,1,1,1)~ EXIT  // Energy Drain
        IF ~HaveSpell(2915)~ THEN REPLY #7851 DO ~TakePartyGold(5000) DestroyGold(5000) RemoveSpell(2915) GiveItemCreate("SCRL9X",Myself,1,1,1)~ EXIT  // Black Blade of Disaster
        IF ~HaveSpell(2916)~ THEN REPLY #26356 DO ~TakePartyGold(5000) DestroyGold(5000) RemoveSpell(2916) GiveItemCreate("SCRL9Y",Myself,1,1,1)~ EXIT  // Shapechange
        IF ~HaveSpell(2917)~ THEN REPLY #35553 DO ~TakePartyGold(5000) DestroyGold(5000) RemoveSpell(2917) GiveItemCreate("SCRL9Z",Myself,1,1,1)~ EXIT  // Freedom
        IF ~HaveSpell(2918)~ THEN REPLY #63153 DO ~TakePartyGold(5000) DestroyGold(5000) RemoveSpell(2918) GiveItemCreate("SCRLB2",Myself,1,1,1)~ EXIT  // Bigby's Crushing Hand
        IF ~HaveSpell(2919)~ THEN REPLY #63157 DO ~TakePartyGold(5000) DestroyGold(5000) RemoveSpell(2919) GiveItemCreate("SCRLB4",Myself,1,1,1)~ EXIT  // Wish
        IF ~~ THEN REPLY @8261 GOTO RR#SCRL00  // Select a different spell level
    END
