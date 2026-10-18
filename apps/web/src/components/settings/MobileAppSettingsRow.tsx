import { AppleIcon } from "../Icons";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { QRCodeSvg } from "../ui/qr-code";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const IOS_TESTFLIGHT_URL = "https://testflight.apple.com/join/VUJkRPwq";

export function MobileAppSettingsRow() {
  return (
    <SettingsRow
      {...searchableSetting("mobile-app")}
      description="Connect to your server from your phone or tablet."
      control={
        <Popover>
          <PopoverTrigger render={<Button size="sm" variant="outline" />}>
            <AppleIcon />
            iPhone and iPad
          </PopoverTrigger>
          <PopoverPopup align="end">
            <div className="flex flex-col items-center gap-3">
              <PopoverTitle>TestFlight</PopoverTitle>
              <p className="text-xs text-muted-foreground">Scan with your phone camera.</p>
              <div className="rounded-lg bg-white p-1.5">
                <QRCodeSvg
                  value={IOS_TESTFLIGHT_URL}
                  size={128}
                  level="M"
                  marginSize={1}
                  title="TestFlight link"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                render={<a href={IOS_TESTFLIGHT_URL} target="_blank" rel="noreferrer noopener" />}
              >
                Open TestFlight
              </Button>
            </div>
          </PopoverPopup>
        </Popover>
      }
    />
  );
}
