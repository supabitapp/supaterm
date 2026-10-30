#ifdef RCT_NEW_ARCH_ENABLED
#import <React/RCTComponent.h>
#import <React/RCTViewComponentView.h>
#import <UIKit/UIKit.h>

#ifndef SupatermSourceTextRunNativeComponent_h
#define SupatermSourceTextRunNativeComponent_h

NS_ASSUME_NONNULL_BEGIN

@interface SupatermSourceTextRun : RCTViewComponentView

@property(nonatomic, copy, nullable) NSString *text;
@end

NS_ASSUME_NONNULL_END

#endif
#endif
