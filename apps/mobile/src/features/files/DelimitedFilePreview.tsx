import { ScrollView, View } from "react-native";
import type { parseDelimitedPreview } from "@supaterm/shared/delimitedPreview";
import { withOccurrenceKeys } from "@supaterm/shared/occurrenceKeys";
import { AppText as Text } from "../../components/ui/AppText";
import { FilePreviewNotice } from "../../components/FilePreviewFeedback";

export function DelimitedFilePreview(props: {
  readonly table: ReturnType<typeof parseDelimitedPreview>;
}) {
  return (
    <ScrollView className="flex-1">
      {props.table.truncated ? (
        <FilePreviewNotice>
          Table limited to the first 100 rows and 30 columns. Source shows the rest.
        </FilePreviewNotice>
      ) : null}
      <ScrollView horizontal>
        <View>
          {withOccurrenceKeys(props.table.rows, (row) => row.join("\t")).map(
            ({ item: row, key: rowKey }, rowIndex) => (
              <View key={rowKey} className={rowIndex === 0 ? "flex-row bg-subtle" : "flex-row"}>
                {withOccurrenceKeys(row, (cell) => cell).map(({ item: cell, key: cellKey }) => (
                  <View key={cellKey} className="w-48 border-r border-b border-border px-3 py-2">
                    <Text
                      selectable
                      className={
                        rowIndex === 0
                          ? "text-sm font-supaterm-semibold text-foreground"
                          : "text-sm text-foreground"
                      }
                    >
                      {cell}
                    </Text>
                  </View>
                ))}
              </View>
            ),
          )}
        </View>
      </ScrollView>
    </ScrollView>
  );
}
