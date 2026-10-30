require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'SupatermTerminalNative'
  s.version = package['version']
  s.summary = 'Native terminal surface for Supaterm mobile.'
  s.description = 'Native terminal surface bridge used by the Supaterm React Native app.'
  s.homepage = 'https://supaterm.com'
  s.license = { :type => 'UNLICENSED' }
  s.author = { 'Supaterm' => 'hello@supaterm.com' }
  s.platforms = { :ios => '16.1' }
  s.source = { :path => '.' }
  s.source_files = 'ios/**/*.{h,m,mm,swift}'
  s.vendored_frameworks = 'Vendor/libghostty/GhosttyKit.xcframework'
  s.frameworks = 'IOSurface', 'Metal', 'MetalKit', 'QuartzCore', 'UIKit'
  s.libraries = 'c++', 'z'
  s.swift_version = '5.9'
  s.dependency 'ExpoModulesCore'
end
