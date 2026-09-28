import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import example from "../../../testdata/ledger-example.json";
import { ListNodesResponseSchema } from "../gen/focusledger/v1/ledger_service_pb";
import type { NodePb } from "../gen/focusledger/v1/model_pb";

export const exampleNow = new Date(example.now);

export const exampleExpected = example.expected;

export function exampleNodes(): NodePb[] {
  return fromJson(
    ListNodesResponseSchema,
    example.listNodesResponse as JsonValue,
  ).nodes;
}
