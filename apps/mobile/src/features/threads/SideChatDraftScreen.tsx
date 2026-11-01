import { StackActions, useNavigation, useRoute, type Route } from "@react-navigation/native";
import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { useState } from "react";
import { ScrollView, TextInput, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useQuietThreadShell } from "../../state/entities";
import { useSideChatDisabledReason, useStartSideChat } from "./useSideChat";

/** An empty side chat of the route's thread. Nothing exists on the server until its first send. */
export function SideChatDraftRouteScreen() {
  const navigation = useNavigation();
  const route = useRoute<Route<string, { environmentId?: string; threadId?: string }>>();
  const parentRef =
    route.params?.environmentId && route.params.threadId
      ? scopeThreadRef(
          EnvironmentId.make(route.params.environmentId),
          ThreadId.make(route.params.threadId),
        )
      : null;
  const parent = useQuietThreadShell(parentRef);
  const disabledReason = useSideChatDisabledReason(parent);
  const startSideChat = useStartSideChat();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (parent === null || disabledReason !== null || sending || text.trim() === "") return;
    setSending(true);
    const threadId = await startSideChat({
      environmentId: parent.environmentId,
      parentThreadId: parent.id,
      text: text.trim(),
    });
    setSending(false);
    if (threadId === null) return;
    navigation.dispatch(
      StackActions.replace("Thread", { environmentId: parent.environmentId, threadId }),
    );
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      className="flex-1 bg-screen"
    >
      <View className="gap-3 p-4">
        <Text className="text-sm text-foreground-muted">
          {disabledReason ??
            `Ask about “${parent?.title ?? "this thread"}” without adding to it. It keeps working while you ask.`}
        </Text>
        <TextInput
          accessibilityLabel="Side chat message"
          value={text}
          onChangeText={setText}
          autoFocus
          multiline
          scrollEnabled
          textAlignVertical="top"
          readOnly={sending}
          placeholder="Ask a side question"
          placeholderTextColorClassName="accent-foreground-muted"
          className="max-h-60 min-h-28 rounded-2xl bg-card p-3 font-sans text-base text-foreground"
        />
        <Button
          label="Send"
          tone="primary"
          fullWidth
          loading={sending}
          disabled={disabledReason !== null || text.trim() === ""}
          onPress={() => void send()}
        />
      </View>
    </ScrollView>
  );
}
