require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))
Pod::Spec.new do |s|
  s.name = 'SupatermPush'
  s.version = package['version']
  s.summary = 'End-to-end encrypted push notification keys for Supaterm mobile.'
  s.homepage = 'https://supaterm.com'
  s.license = { :type => 'MIT' }
  s.author = { 'Supaterm' => 'hello@supaterm.com' }
  s.platforms = { :ios => '17.0' }
  s.source = { :path => '.' }
  s.source_files = 'ios/**/*.swift', 'Sources/SupatermPushCore/**/*.swift'
  s.frameworks = 'CryptoKit', 'Security'
  s.swift_version = '5.9'
  s.dependency 'ExpoModulesCore'
end
