import { describe, expect, test } from "vitest";
import { exampleNodes } from "../ledger/exampleData";
import { buildTree, flattenTree } from "./treeModel";

describe("treeModel", () => {
  test("buildTree_example_nestsChildrenInCreationOrder", () => {
    const rows = buildTree(exampleNodes());

    expect(
      flattenTree(rows).map((row) => [row.node.name, row.path.join(" › ")]),
    ).toEqual([
      ["Book", ""],
      ["Chapter 1", "Book"],
      ["Notes", "Book › Chapter 1"],
      ["Chapter 2", "Book"],
      ["Admin", ""],
    ]);
  });

  test("buildTree_example_carriesTheRolledUpFigures", () => {
    const book = buildTree(exampleNodes())[0];

    expect(book.rollUp.rolledUp).toMatchObject({
      doneCycles: 8,
      estimatedCycles: 40,
      minutes: 490,
    });
  });
});
