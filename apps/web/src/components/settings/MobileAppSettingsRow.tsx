import { AppleIcon } from "../Icons";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { QRCodeSvg } from "../ui/qr-code";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { useGT, T } from "gt-react";

const IOS_TESTFLIGHT_URL = "https://testflight.apple.com/join/VUJkRPwq";

export function MobileAppSettingsRow() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  return (
    <SettingsRow
      {...searchableSetting("mobile-app")}
      description={gt("Connect to your server from your phone or tablet.")}
      control={
        <Popover>
          <PopoverTrigger render={<Button size="sm" variant="outline" />}>
            <AppleIcon />
            <T>iPhone and iPad</T>
          </PopoverTrigger>
          <PopoverPopup align="end">
            <div className="flex flex-col items-center gap-3">
              <PopoverTitle>TestFlight</PopoverTitle>
              <p className="text-xs text-muted-foreground">
                <T>Scan with your phone camera.</T>
              </p>
              <div className="rounded-lg bg-white p-1.5">
                <QRCodeSvg
                  value={IOS_TESTFLIGHT_URL}
                  size={128}
                  level="M"
                  marginSize={1}
                  title={gt("TestFlight link")}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                render={<a href={IOS_TESTFLIGHT_URL} target="_blank" rel="noreferrer noopener" />}
              >
                <T>Open TestFlight</T>
              </Button>
            </div>
          </PopoverPopup>
        </Popover>
      }
    />
  );
}
