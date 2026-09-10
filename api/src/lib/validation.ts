import { z } from "zod";
import { isValidIsoDate } from "./dates.js";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.")
  .refine(isValidIsoDate, "Use a valid calendar date.");
const categorySchema = z.enum(["Platform", "Certificate", "Device", "Other"]);
const billingTypeSchema = z.enum(["recurring", "annual", "one_time"]);
const statusSchema = z.enum(["active", "closed"]);
const periodKindSchema = z.enum(["month", "year", "one_time"]);
const editablePeriodKindSchema = z.enum(["month", "year", "one_time", "adjustment"]);
export const entrySchema = z.object({
  amount: z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000),
  currency: z.string().trim().toUpperCase().pipe(z.literal("TRY")).default("TRY"),
  periodStart: dateSchema,
  periodKind: periodKindSchema,
  membership: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});
export const updateEntrySchema = z
  .object({
    amount: z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000),
    currency: z.string().trim().toUpperCase().pipe(z.literal("TRY")),
    periodStart: dateSchema,
    periodKind: editablePeriodKindSchema,
    membership: z.string().trim().max(120).nullable(),
    note: z.string().trim().max(500).nullable(),
  })
  .partial();
export const itemSchema = z.object({
  name: z.string().trim().min(1).max(140),
  category: categorySchema,
  billingType: billingTypeSchema,
  plan: z.string().trim().max(120).optional().nullable(),
  url: z.union([z.url({ protocol: /^https?$/ }), z.literal("")]).optional().nullable(),
  account: z.string().trim().max(160).optional().nullable(),
  powerWatts: z.number().finite().nonnegative().optional().nullable(),
  status: statusSchema.default("active"),
  closedAt: dateSchema.optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  initialEntry: entrySchema.optional(),
});
export const updateItemSchema = itemSchema.omit({ initialEntry: true }).extend({ status: statusSchema }).partial();
export const filtersSchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: categorySchema.optional(),
  status: statusSchema.optional(),
});
export const statementImportSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  data: z.string().min(1).max(14_000_000, "PDF files must be 10 MB or smaller."),
  apply: z.boolean().optional().default(false),
  manualMappings: z
    .array(
      z.object({
        date: dateSchema,
        amount: z.number().finite(),
        description: z.string().trim().min(1).max(500),
        name: z.string().trim().min(1).max(140),
        category: categorySchema,
        billingType: billingTypeSchema,
        plan: z.string().trim().max(120).optional().nullable(),
        url: z.union([z.url({ protocol: /^https?$/ }), z.literal("")]).optional().nullable(),
        account: z.string().trim().max(160).optional().nullable(),
        pattern: z.string().trim().max(120).optional().nullable(),
      }),
    )
    .optional()
    .default([]),
});


export const slipImportSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  data: z.string().min(1).max(14_000_000, "PDF files must be 10 MB or smaller."),
  apply: z.boolean().optional().default(false),
  manualMapping: z
    .object({
      name: z.string().trim().min(1).max(140),
      category: categorySchema,
      billingType: billingTypeSchema,
      plan: z.string().trim().max(120).optional().nullable(),
      url: z.union([z.url({ protocol: /^https?$/ }), z.literal("")]).optional().nullable(),
      account: z.string().trim().max(160).optional().nullable(),
      pattern: z.string().trim().max(120).optional().nullable(),
    })
    .optional()
    .nullable(),
});

