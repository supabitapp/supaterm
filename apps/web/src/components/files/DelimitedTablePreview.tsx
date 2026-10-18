import { parseDelimitedPreview } from "@supaterm/shared/delimitedPreview";
import { withOccurrenceKeys } from "@supaterm/shared/occurrenceKeys";

import { FileSurfaceNotice } from "./fileSurfaceChrome";

export function DelimitedTablePreview(props: {
  readonly name: string;
  readonly text: string;
  readonly delimiter: "," | "\t";
}) {
  const table = parseDelimitedPreview(props.text, props.delimiter);
  const [header, ...body] = table.rows;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {table.truncated ? (
        <FileSurfaceNotice>
          Table limited to the first 100 rows and 30 columns. Switch to source for the rest.
        </FileSurfaceNotice>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <table
          className="min-w-full border-separate border-spacing-0 text-xs"
          aria-label={props.name}
        >
          {header ? (
            <thead className="sticky top-0 z-10">
              <tr>
                {withOccurrenceKeys(header, (cell) => cell).map(({ item: cell, key }) => (
                  <th
                    key={key}
                    scope="col"
                    className="max-w-80 border-b border-border bg-muted/60 px-3 py-1.5 text-left align-bottom font-medium whitespace-pre-wrap break-words backdrop-blur"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {withOccurrenceKeys(body, (row) => row.join("\u0000")).map(({ item: row, key }) => (
              <tr key={key} className="even:bg-muted/30">
                {withOccurrenceKeys(row, (cell) => cell).map(({ item: cell, key: cellKey }) => (
                  <td
                    key={cellKey}
                    className="max-w-80 border-b border-border/60 px-3 py-1.5 align-top whitespace-pre-wrap break-words tabular-nums"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
