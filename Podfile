# Reproductor: VLCKit oficial de VideoLAN (MKV, AC3/E-AC3, DTS, varias pistas de audio y subtítulos).
platform :ios, '16.0'
use_frameworks!

target 'LatMpx' do
  pod 'MobileVLCKit', '~> 3.6.0'
end

post_install do |installer|
  installer.pods_project.targets.each do |t|
    t.build_configurations.each do |c|
      c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '16.0'
    end
  end
end
