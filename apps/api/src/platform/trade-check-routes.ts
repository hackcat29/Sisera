import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../auth.js";
import { TradeCheckError, type TradeCheckService } from "./trade-check.js";

export function registerTradeCheckRoutes(app: FastifyInstance, service: TradeCheckService) {
  app.get(
    "/v1/trade-check",
    {
      preHandler: requirePermission("market:read"),
      config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const query = z.object({ input: z.string().min(1).max(512) }).safeParse(request.query);
      if (!query.success)
        return reply
          .code(400)
          .send({ message: "Paste a Solana token address or supported token link." });
      try {
        return { data: await service.check(query.data.input) };
      } catch (error) {
        if (error instanceof TradeCheckError)
          return reply.code(error.status).send({ message: error.message });
        request.log.warn({ err: error }, "Trade Check provider failure");
        return reply
          .code(503)
          .send({ message: "Trade Check could not reach its data sources. Try again shortly." });
      }
    },
  );
  app.post(
    "/v1/trade-check/chat",
    {
      preHandler: requirePermission("market:read"),
      config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const body = z
        .object({ input: z.string().min(1).max(512), question: z.string().trim().min(1).max(500) })
        .safeParse(request.body);
      if (!body.success)
        return reply
          .code(400)
          .send({ message: "Provide a token and a question of up to 500 characters." });
      try {
        return { data: await service.answer(body.data.input, body.data.question) };
      } catch (error) {
        if (error instanceof TradeCheckError)
          return reply.code(error.status).send({ message: error.message });
        return reply.code(503).send({
          message: "The follow-up could not be completed. Your token checks remain available.",
        });
      }
    },
  );
}
