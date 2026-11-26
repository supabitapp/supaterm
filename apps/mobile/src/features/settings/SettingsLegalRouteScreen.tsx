import { SettingsLegalDocumentRouteScreen } from "./components/SettingsLegalDocumentRouteScreen";
import { LEGAL_URL } from "./lib/legal-document-url";
import { useGT } from "gt-react-native";

export function SettingsLegalRouteScreen() {
  const gt = useGT();
  return (
    <SettingsLegalDocumentRouteScreen
      documentName={gt("Legal", { $context: "legal documents page title" })}
      documentUrl={LEGAL_URL}
    />
  );
}
