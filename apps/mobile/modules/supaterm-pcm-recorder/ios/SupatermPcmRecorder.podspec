Pod::Spec.new do |s|
  s.name           = 'SupatermPcmRecorder'
  s.version        = '1.0.0'
  s.summary        = 'Native 16 kHz PCM voice recorder for Supaterm mobile.'
  s.author         = 'Supaterm'
  s.homepage       = 'https://supaterm.com'
  s.platforms      = { :ios => '18.0' }
  s.source         = { :path => '.' }
  s.static_framework = true
  s.swift_version  = '5.9'
  s.frameworks     = 'AVFoundation'

  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.swift"
end
