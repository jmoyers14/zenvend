import { injectable } from "tsyringe";
import type { Types } from "mongoose";
import type { CostBasisLine, ReplacementCostLine } from "@zenvend/domain";
import { PurchaseModel } from "../../models/Purchase.ts";
import { toId } from "../ids.ts";
import type {
  Purchase,
  PurchaseDateRange,
  PurchaseInput,
  PurchaseListQuery,
  PurchasePage,
  PurchaseRepository,
  PurchaseSummary,
  PurchaseUpdate,
} from "./PurchaseRepository.ts";

type PurchaseDoc = {
  _id: Types.ObjectId;
  purchasedAt: Date;
  vendor: string;
  lines: {
    productId: Types.ObjectId;
    units: number;
    totalCostCents: number;
    packId?: Types.ObjectId | null;
  }[];
  receiptTotalCents?: number | null;
  notes?: string | null;
  clientRequestId: string;
  createdAt: Date;
  updatedAt: Date;
};

/** The read order. The _id tiebreaker is half the correctness of the cursor. */
const LIST_SORT = { purchasedAt: -1, _id: -1 } as const;

/**
 * The org's live purchases inside a date range. The list and the summary both
 * start here, so the total always covers exactly the rows the list pages through.
 *
 * Also a $match stage, where Mongoose casts nothing: every value must already
 * be its stored type. orgId is stored as a string and purchasedAt as a Date.
 */
export function purchaseRangeFilter(
  orgId: string,
  range: PurchaseDateRange,
): Record<string, unknown> {
  const filter: Record<string, unknown> = { orgId, deletedAt: null };

  const bounds: Record<string, Date> = {};
  if (range.from) {
    bounds.$gte = new Date(range.from);
  }
  if (range.to) {
    bounds.$lte = new Date(range.to);
  }
  if (Object.keys(bounds).length > 0) {
    filter.purchasedAt = bounds;
  }

  return filter;
}

/**
 * The filter for one page. Exported because it IS the correctness story and
 * there is no Mongo harness in unit tests: the $or says "strictly past the
 * cursor position", and its second branch is the only thing standing between a
 * page boundary and rows sharing a purchasedAt being duplicated or skipped.
 *
 * Pure and Mongoose-free — `_id` is handed over as a string and cast by the
 * schema. The service validates the cursor's id is 24-hex before it gets here,
 * so that cast cannot raise a CastError.
 */
export function purchaseListFilter(
  orgId: string,
  query: PurchaseListQuery,
): Record<string, unknown> {
  const filter = purchaseRangeFilter(orgId, query);

  const cursor = query.cursor;
  if (cursor) {
    // Must stay at full millisecond precision: truncating this to a day would
    // make the equality branch below match nothing and silently skip rows.
    const at = new Date(cursor.purchasedAt);
    // ANDed with any range above — $or is its own top-level key, so the two
    // purchasedAt predicates don't collide.
    filter.$or = [
      { purchasedAt: { $lt: at } },
      { purchasedAt: at, _id: { $lt: cursor.id } },
    ];
  }

  return filter;
}

@injectable()
export class PurchaseRepositoryImpl implements PurchaseRepository {
  async findPageByOrg(
    orgId: string,
    query: PurchaseListQuery,
  ): Promise<PurchasePage> {
    // limit + 1 is how "is there another page" gets answered without a count().
    const docs = await PurchaseModel.find(purchaseListFilter(orgId, query))
      .sort(LIST_SORT)
      .limit(query.limit + 1)
      .lean<PurchaseDoc[]>();
    return {
      items: docs.slice(0, query.limit).map(toPurchase),
      hasMore: docs.length > query.limit,
    };
  }

  async findSummaryByOrg(
    orgId: string,
    range: PurchaseDateRange,
  ): Promise<PurchaseSummary> {
    // The inner $sum totals one purchase's lines array; the outer accumulates
    // across purchases. A $group over no documents emits nothing at all.
    const groups = await PurchaseModel.aggregate<PurchaseSummary>([
      { $match: purchaseRangeFilter(orgId, range) },
      {
        $group: {
          _id: null,
          spentCents: { $sum: { $sum: "$lines.totalCostCents" } },
          count: { $sum: 1 },
        },
      },
      { $project: { _id: 0, spentCents: 1, count: 1 } },
    ]);
    return groups[0] ?? { spentCents: 0, count: 0 };
  }

  async findById(orgId: string, id: string): Promise<Purchase | null> {
    const doc = await PurchaseModel.findOne({
      _id: id,
      orgId,
      deletedAt: null,
    }).lean<PurchaseDoc | null>();
    return doc ? toPurchase(doc) : null;
  }

  async findCostBasisLines(orgId: string): Promise<CostBasisLine[]> {
    // Projected to `lines` alone: the vendor, notes and receipt total are of no
    // interest to the engine, and leaving them out is what keeps an all-time
    // read affordable as the purchase history grows.
    const docs = await PurchaseModel.find(
      { orgId, deletedAt: null },
      { lines: 1, _id: 0 },
    ).lean<{ lines: PurchaseDoc["lines"] }[]>();

    return docs.flatMap((doc) =>
      doc.lines.map((line) => ({
        productId: toId(line.productId),
        units: line.units,
        totalCostCents: line.totalCostCents,
      })),
    );
  }

  async findReplacementCostLines(orgId: string): Promise<ReplacementCostLine[]> {
    const docs = await PurchaseModel.find(
      { orgId, deletedAt: null },
      { lines: 1, purchasedAt: 1, vendor: 1 },
    ).lean<Pick<PurchaseDoc, "_id" | "purchasedAt" | "vendor" | "lines">[]>();

    return docs.flatMap((doc) => {
      // Per document, not per line — a 20-line receipt converted these 20 times.
      const purchaseId = toId(doc._id);
      const purchasedAt = doc.purchasedAt.toISOString();

      return doc.lines.map((line) => ({
        productId: toId(line.productId),
        purchaseId,
        units: line.units,
        totalCostCents: line.totalCostCents,
        purchasedAt,
        vendor: doc.vendor,
      }));
    });
  }

  async findByClientRequestId(
    orgId: string,
    clientRequestId: string,
  ): Promise<Purchase | null> {
    const doc = await PurchaseModel.findOne({
      orgId,
      clientRequestId,
    }).lean<PurchaseDoc | null>();
    return doc ? toPurchase(doc) : null;
  }

  async create(orgId: string, data: PurchaseInput): Promise<Purchase> {
    const doc = await PurchaseModel.create({ orgId, ...data });
    return toPurchase(doc.toObject() as PurchaseDoc);
  }

  async update(
    orgId: string,
    id: string,
    data: PurchaseUpdate,
  ): Promise<Purchase | null> {
    const doc = await PurchaseModel.findOneAndUpdate(
      { _id: id, orgId, deletedAt: null },
      data,
      { returnDocument: "after" },
    ).lean<PurchaseDoc | null>();
    return doc ? toPurchase(doc) : null;
  }

  async softDelete(orgId: string, id: string): Promise<void> {
    await PurchaseModel.updateOne(
      { _id: id, orgId, deletedAt: null },
      { deletedAt: new Date() },
    );
  }
}

function toPurchase(doc: PurchaseDoc): Purchase {
  return {
    id: toId(doc._id),
    purchasedAt: doc.purchasedAt.toISOString(),
    vendor: doc.vendor,
    lines: doc.lines.map((line) => ({
      productId: toId(line.productId),
      units: line.units,
      totalCostCents: line.totalCostCents,
      packId: toId(line.packId),
    })),
    receiptTotalCents: doc.receiptTotalCents ?? null,
    notes: doc.notes ?? null,
    clientRequestId: doc.clientRequestId,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
