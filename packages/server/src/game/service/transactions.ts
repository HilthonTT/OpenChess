import { Prisma } from "@openchess/database";
import { db } from "@openchess/database/client";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { throwProblem } from "../../lib/problem-details";

export const SERIALIZATION_FAILURE = "P2034";

export async function serializable<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await db.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === SERIALIZATION_FAILURE
    ) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "Another request touched this game at the same time. Refetch it and try again.",
      );
    }
    throw error;
  }
}
