import { randomInt } from "node:crypto";

const TRAINS: Record<string, { number: string; name: string; departs: string; arrives: string }> = {
  "CSMT-PUNE": { number: "12127", name: "Intercity Express", departs: "06:40", arrives: "09:57" },
  "CSMT-NGP": { number: "12289", name: "Duronto Express", departs: "20:15", arrives: "07:55" },
  "BCT-NDLS": { number: "12951", name: "Rajdhani Express", departs: "17:00", arrives: "08:32" },
};

export type TicketRequest = { from: string; to: string; date: string };

/** The merchant's actual product: a (fake) rail ticket. */
export function bookTicket({ from, to, date }: TicketRequest) {
  const route = `${from}-${to}`.toUpperCase();
  const train = TRAINS[route] ?? { number: "11007", name: "Deccan Express", departs: "07:10", arrives: "11:05" };
  return {
    pnr: String(randomInt(1_000_000_000, 9_999_999_999)),
    route,
    date,
    train,
    coach: `C${randomInt(1, 9)}`,
    seat: randomInt(1, 78),
    status: "CONFIRMED",
  };
}

export const KNOWN_ROUTES = Object.keys(TRAINS);
