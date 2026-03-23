import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as api from "./hypixel.js";

/**
 * Resolves a Minecraft username to UUID, handling both formats.
 */
async function resolveUuid(usernameOrUuid: string): Promise<string> {
  // Already a UUID (with or without dashes)
  if (/^[0-9a-f]{32}$/i.test(usernameOrUuid.replace(/-/g, ""))) {
    return usernameOrUuid.replace(/-/g, "");
  }
  const { uuid } = await api.getPlayerByName(usernameOrUuid);
  return uuid;
}

/**
 * Extract the selected/active profile from the profiles response.
 */
function getSelectedProfile(profiles: any): any {
  if (!profiles?.profiles?.length) return null;
  return profiles.profiles.find((p: any) => p.selected) ?? profiles.profiles[0];
}

function memberData(profile: any, uuid: string): any {
  return profile?.members?.[uuid] ?? null;
}

// -------------------------------------------------------------------

export function registerTools(server: McpServer) {
  // ---- Player Profile ----
  server.tool(
    "get_player_profile",
    "Get a Hypixel Skyblock player's profile: skills, slayers, dungeons, mining, and more. Accepts username or UUID.",
    { player: z.string().describe("Minecraft username or UUID") },
    async ({ player }) => {
      const uuid = await resolveUuid(player);
      const profiles = (await api.getSkyblockProfiles(uuid)) as any;
      const profile = getSelectedProfile(profiles);
      if (!profile) {
        return { content: [{ type: "text" as const, text: "No Skyblock profile found for this player." }] };
      }

      const member = memberData(profile, uuid);
      if (!member) {
        return { content: [{ type: "text" as const, text: "Player not found in the selected profile." }] };
      }

      const summary: Record<string, unknown> = {
        profile_name: profile.cute_name,
        game_mode: profile.game_mode ?? "normal",
      };

      // Skills
      if (member.player_data?.experience) {
        summary.skill_xp = member.player_data.experience;
      }

      // Slayer
      if (member.slayer?.slayer_bosses) {
        const slayers: Record<string, number> = {};
        for (const [boss, data] of Object.entries(member.slayer.slayer_bosses) as [string, any][]) {
          slayers[boss] = data.xp ?? 0;
        }
        summary.slayers = slayers;
      }

      // Dungeons
      if (member.dungeons?.dungeon_types?.catacombs) {
        const cata = member.dungeons.dungeon_types.catacombs;
        summary.catacombs_xp = cata.experience ?? 0;
      }

      // Mining core (HOTM)
      if (member.mining_core) {
        summary.hotm_experience = member.mining_core.experience ?? 0;
        summary.hotm_tokens_spent = member.mining_core.tokens_spent ?? 0;
      }

      // Bestiary
      if (member.bestiary?.kills) {
        const totalKills = Object.values(member.bestiary.kills as Record<string, number>).reduce(
          (a, b) => a + b,
          0
        );
        summary.bestiary_total_kills = totalKills;
      }

      // Purse & bank
      if (member.currencies) {
        summary.coin_purse = member.currencies.coin_purse ?? 0;
      }
      if (profile.banking) {
        summary.bank_balance = profile.banking.balance ?? 0;
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  // ---- Bazaar Prices ----
  server.tool(
    "get_bazaar_prices",
    "Get current Skyblock Bazaar prices. Optionally filter to a specific item. Returns buy/sell price, volume, and orders.",
    {
      item_id: z
        .string()
        .optional()
        .describe("Skyblock item ID (e.g. ENCHANTED_DIAMOND). Omit for full bazaar snapshot."),
    },
    async ({ item_id }) => {
      const data = (await api.getBazaar()) as any;
      const products = data.products ?? {};

      if (item_id) {
        const key = item_id.toUpperCase();
        const product = products[key];
        if (!product) {
          return { content: [{ type: "text" as const, text: `Item '${key}' not found in bazaar.` }] };
        }
        const qs = product.quick_status;
        const info = {
          item: key,
          buy_price: qs.buyPrice,
          sell_price: qs.sellPrice,
          buy_volume: qs.buyVolume,
          sell_volume: qs.sellVolume,
          buy_orders: qs.buyOrders,
          sell_orders: qs.sellOrders,
          buy_moving_week: qs.buyMovingWeek,
          sell_moving_week: qs.sellMovingWeek,
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(info, null, 2) }] };
      }

      // Return top movers summary instead of the entire bazaar
      const items = Object.entries(products).map(([id, p]: [string, any]) => ({
        id,
        buy: p.quick_status.buyPrice,
        sell: p.quick_status.sellPrice,
        spread: p.quick_status.buyPrice - p.quick_status.sellPrice,
        volume: p.quick_status.buyVolume + p.quick_status.sellVolume,
      }));
      items.sort((a, b) => b.volume - a.volume);
      const top50 = items.slice(0, 50);

      return {
        content: [
          {
            type: "text" as const,
            text: `Bazaar snapshot (top 50 by volume):\n${JSON.stringify(top50, null, 2)}`,
          },
        ],
      };
    }
  );

  // ---- Auction House ----
  server.tool(
    "search_auctions",
    "Search the Skyblock Auction House. Can search by player or browse the latest page of auctions.",
    {
      player: z
        .string()
        .optional()
        .describe("Minecraft username or UUID to find their auctions"),
      page: z
        .number()
        .optional()
        .describe("Auction page number (0-indexed). Omit for page 0."),
    },
    async ({ player, page }) => {
      if (player) {
        const uuid = await resolveUuid(player);
        const data = (await api.getAuctionsByPlayer(uuid)) as any;
        const auctions = (data.auctions ?? []).slice(0, 25).map((a: any) => ({
          item: a.item_name,
          tier: a.tier,
          starting_bid: a.starting_bid,
          highest_bid: a.highest_bid_amount,
          bin: a.bin ?? false,
          end: new Date(a.end).toISOString(),
        }));
        return {
          content: [
            {
              type: "text" as const,
              text: auctions.length
                ? JSON.stringify(auctions, null, 2)
                : "No active auctions found for this player.",
            },
          ],
        };
      }

      const data = (await api.getAuctions(page ?? 0)) as any;
      const total = data.totalPages ?? 0;
      const auctions = (data.auctions ?? []).slice(0, 25).map((a: any) => ({
        item: a.item_name,
        tier: a.tier,
        starting_bid: a.starting_bid,
        highest_bid: a.highest_bid_amount,
        bin: a.bin ?? false,
        end: new Date(a.end).toISOString(),
      }));
      return {
        content: [
          {
            type: "text" as const,
            text: `Page ${page ?? 0} of ${total}:\n${JSON.stringify(auctions, null, 2)}`,
          },
        ],
      };
    }
  );

  // ---- Mayor / Election ----
  server.tool(
    "get_election",
    "Get the current Skyblock mayor and active perks, plus election candidates if an election is running.",
    {},
    async () => {
      const data = (await api.getElection()) as any;
      const mayor = data.mayor;
      const result: Record<string, unknown> = {};

      if (mayor) {
        result.current_mayor = {
          name: mayor.name,
          key: mayor.key,
          perks: (mayor.perks ?? []).map((p: any) => ({
            name: p.name,
            description: p.description,
          })),
        };
      }

      if (data.current?.candidates) {
        result.election_candidates = data.current.candidates.map((c: any) => ({
          name: c.name,
          key: c.key,
          votes: c.votes,
          perks: (c.perks ?? []).map((p: any) => p.name),
        }));
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ---- Skills Reference ----
  server.tool(
    "get_skills_info",
    "Get Skyblock skills reference data — XP requirements per level for all skills.",
    {},
    async () => {
      const data = (await api.getSkills()) as any;
      const skills = data.skills ?? data.collections ?? {};
      const summary: Record<string, { maxLevel: number; description: string }> = {};
      for (const [key, skill] of Object.entries(skills) as [string, any][]) {
        summary[key] = {
          maxLevel: skill.maxLevel ?? skill.levels?.length ?? 0,
          description: skill.description ?? "",
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  // ---- Collections Reference ----
  server.tool(
    "get_collections_info",
    "Get Skyblock collections reference data — all collection categories, items, and tier unlock requirements.",
    {},
    async () => {
      const data = (await api.getCollections()) as any;
      const categories = data.collections ?? {};
      const summary: Record<string, string[]> = {};
      for (const [cat, catData] of Object.entries(categories) as [string, any][]) {
        summary[cat] = Object.keys(catData.items ?? {});
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  // ---- Items Database ----
  server.tool(
    "search_items",
    "Search the Skyblock items database by name or ID. Returns item details including rarity, category, and stats.",
    {
      query: z.string().describe("Item name or ID to search for (case-insensitive partial match)"),
    },
    async ({ query }) => {
      const data = (await api.getItems()) as any;
      const items = data.items ?? [];
      const q = query.toLowerCase();
      const matches = items
        .filter(
          (item: any) =>
            (item.id ?? "").toLowerCase().includes(q) ||
            (item.name ?? "").toLowerCase().includes(q)
        )
        .slice(0, 20)
        .map((item: any) => ({
          id: item.id,
          name: item.name,
          tier: item.tier,
          category: item.category,
          npc_sell_price: item.npc_sell_price,
        }));

      return {
        content: [
          {
            type: "text" as const,
            text: matches.length
              ? JSON.stringify(matches, null, 2)
              : `No items matching '${query}'.`,
          },
        ],
      };
    }
  );

  // ---- Networth Estimate ----
  server.tool(
    "estimate_networth",
    "Estimate a player's Skyblock networth from their profile — bank, purse, and inventory value based on bazaar prices.",
    {
      player: z.string().describe("Minecraft username or UUID"),
    },
    async ({ player }) => {
      const uuid = await resolveUuid(player);
      const profiles = (await api.getSkyblockProfiles(uuid)) as any;
      const profile = getSelectedProfile(profiles);
      if (!profile) {
        return { content: [{ type: "text" as const, text: "No Skyblock profile found." }] };
      }

      const member = memberData(profile, uuid);
      if (!member) {
        return { content: [{ type: "text" as const, text: "Player not found in profile." }] };
      }

      const purse = member.currencies?.coin_purse ?? 0;
      const bank = profile.banking?.balance ?? 0;

      // Sacks value estimate
      let sacksValue = 0;
      if (member.inventory?.sacks_counts) {
        const bazaar = (await api.getBazaar()) as any;
        const products = bazaar.products ?? {};
        for (const [itemId, count] of Object.entries(member.inventory.sacks_counts) as [string, any][]) {
          const product = products[itemId];
          if (product && typeof count === "number") {
            sacksValue += (product.quick_status?.sellPrice ?? 0) * count;
          }
        }
      }

      const result = {
        player,
        profile_name: profile.cute_name,
        coin_purse: Math.round(purse),
        bank_balance: Math.round(bank),
        sacks_value: Math.round(sacksValue),
        liquid_total: Math.round(purse + bank + sacksValue),
        note: "Inventory/armor/pets networth requires NBT parsing which is not available through the API. This is a liquid-assets estimate only.",
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
