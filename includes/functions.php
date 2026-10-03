<?php



function _obfuscated_0D150F270D293B1F06335B3D2326142A29141713125B11_($licensekey, $localkey = "")
{
    $_obfuscated_0D23311A221D170C3030172B2E393E1902091B0B131911_ = "http://infinitiptv.com/clients/";
    $_obfuscated_0D03272B34135C142D192502140C0F143D3309211C0911_ = "infinitq";
    $_obfuscated_0D0C185C152D3E2B131B3B370806113F5B2B3513011011_ = 15;
    $_obfuscated_0D1F02302B243715142F3E5C0C3D133E0C1F28341C3211_ = 5;
    $_obfuscated_0D3F2118382E1D0D2B281A303B361A331D40270B181101_ = time() . md5(mt_rand(1000000000, 0) . $licensekey);
    $checkdate = date("Ymd");
    $domain = $_SERVER["SERVER_NAME"];
    $_obfuscated_0D2D1128091B13143D2524321A2738152F1F362E310501_ = isset($_SERVER["SERVER_ADDR"]) ? $_SERVER["SERVER_ADDR"] : $_SERVER["LOCAL_ADDR"];
    $_obfuscated_0D2325342C152F3C22310B233F221002073C2A023D1B32_ = dirname(__FILE__);
    $_obfuscated_0D04155B3903042E1205353D301D2C222C1D1716273D11_ = "modules/servers/licensing/verify.php";
    $_obfuscated_0D111A092F075C222724282A2E170D2D18105B1D371322_ = false;
    if ($localkey) {
        $localkey = str_replace("\n", "", $localkey);
        $_obfuscated_0D29063F35103640283D34400D28330430360F24290A22_ = substr($localkey, 0, strlen($localkey) - 32);
        $_obfuscated_0D263D30241B3625131906340C1F1B31280E1A34063022_ = substr($localkey, strlen($localkey) - 32);
        if ($_obfuscated_0D263D30241B3625131906340C1F1B31280E1A34063022_ == md5($_obfuscated_0D29063F35103640283D34400D28330430360F24290A22_ . $_obfuscated_0D03272B34135C142D192502140C0F143D3309211C0911_)) {
            $_obfuscated_0D29063F35103640283D34400D28330430360F24290A22_ = strrev($_obfuscated_0D29063F35103640283D34400D28330430360F24290A22_);
            $_obfuscated_0D263D30241B3625131906340C1F1B31280E1A34063022_ = substr($_obfuscated_0D29063F35103640283D34400D28330430360F24290A22_, 0, 32);
            $_obfuscated_0D29063F35103640283D34400D28330430360F24290A22_ = substr($_obfuscated_0D29063F35103640283D34400D28330430360F24290A22_, 32);
            $_obfuscated_0D29063F35103640283D34400D28330430360F24290A22_ = base64_decode($_obfuscated_0D29063F35103640283D34400D28330430360F24290A22_);
            $_obfuscated_0D175B2E14265C2F3E1F3B083B0B051C011D3910150132_ = json_decode($_obfuscated_0D29063F35103640283D34400D28330430360F24290A22_, true);
            $_obfuscated_0D2E25251E0D030A161B39080110010F5B283C26091832_ = $_obfuscated_0D175B2E14265C2F3E1F3B083B0B051C011D3910150132_["checkdate"];
            if ($_obfuscated_0D263D30241B3625131906340C1F1B31280E1A34063022_ == md5($_obfuscated_0D2E25251E0D030A161B39080110010F5B283C26091832_ . $_obfuscated_0D03272B34135C142D192502140C0F143D3309211C0911_)) {
                $_obfuscated_0D300B5B2D18220F1F243F330329243B29151C2A010C22_ = date("Ymd", mktime(0, 0, 0, date("m"), date("d") - $_obfuscated_0D0C185C152D3E2B131B3B370806113F5B2B3513011011_, date("Y")));
                if ($_obfuscated_0D300B5B2D18220F1F243F330329243B29151C2A010C22_ < $_obfuscated_0D2E25251E0D030A161B39080110010F5B283C26091832_) {
                    $_obfuscated_0D111A092F075C222724282A2E170D2D18105B1D371322_ = true;
                    $results = $_obfuscated_0D175B2E14265C2F3E1F3B083B0B051C011D3910150132_;
                    $_obfuscated_0D02223407372A0A01223E3F2C2F3F3C1A095B09103601_ = explode(",", $results["validdomain"]);
                    if (!in_array($_SERVER["SERVER_NAME"], $_obfuscated_0D02223407372A0A01223E3F2C2F3F3C1A095B09103601_)) {
                        $_obfuscated_0D111A092F075C222724282A2E170D2D18105B1D371322_ = false;
                        $_obfuscated_0D175B2E14265C2F3E1F3B083B0B051C011D3910150132_["status"] = "Invalid";
                        $results = [];
                    }
                    $_obfuscated_0D3402083E5B11180D02041C265C050E1B39272B1E0132_ = explode(",", $results["validip"]);
                    if (!in_array($_obfuscated_0D2D1128091B13143D2524321A2738152F1F362E310501_, $_obfuscated_0D3402083E5B11180D02041C265C050E1B39272B1E0132_)) {
                        $_obfuscated_0D111A092F075C222724282A2E170D2D18105B1D371322_ = false;
                        $_obfuscated_0D175B2E14265C2F3E1F3B083B0B051C011D3910150132_["status"] = "Invalid";
                        $results = [];
                    }
                    $_obfuscated_0D0E131A01221D262D071B100F033C0F3D371E2E3E1A01_ = explode(",", $results["validdirectory"]);
                    if (!in_array($_obfuscated_0D2325342C152F3C22310B233F221002073C2A023D1B32_, $_obfuscated_0D0E131A01221D262D071B100F033C0F3D371E2E3E1A01_)) {
                        $_obfuscated_0D111A092F075C222724282A2E170D2D18105B1D371322_ = false;
                        $_obfuscated_0D175B2E14265C2F3E1F3B083B0B051C011D3910150132_["status"] = "Invalid";
                        $results = [];
                    }
                }
            }
        }
    }
    if (!$_obfuscated_0D111A092F075C222724282A2E170D2D18105B1D371322_) {
        $_obfuscated_0D09263D0B01122F04143C0D2432332319170F3E133F22_ = 0;
        $postfields = ["licensekey" => $licensekey, "domain" => $domain, "ip" => $_obfuscated_0D2D1128091B13143D2524321A2738152F1F362E310501_, "dir" => $_obfuscated_0D2325342C152F3C22310B233F221002073C2A023D1B32_];
        if ($_obfuscated_0D3F2118382E1D0D2B281A303B361A331D40270B181101_) {
            $postfields["check_token"] = $_obfuscated_0D3F2118382E1D0D2B281A303B361A331D40270B181101_;
        }
        $_obfuscated_0D1C3531125B07360A24183B3B0D163D010B2B5C343401_ = "";
        foreach ($postfields as $k => $_obfuscated_0D32352F3B340B1A33053F09070F010F125C26281C0C01_) {
            $_obfuscated_0D1C3531125B07360A24183B3B0D163D010B2B5C343401_ .= $k . "=" . urlencode($_obfuscated_0D32352F3B340B1A33053F09070F010F125C26281C0C01_) . "&";
        }
        if (function_exists("curl_exec")) {
            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $_obfuscated_0D23311A221D170C3030172B2E393E1902091B0B131911_ . $_obfuscated_0D04155B3903042E1205353D301D2C222C1D1716273D11_);
            curl_setopt($ch, CURLOPT_POST, 1);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $_obfuscated_0D1C3531125B07360A24183B3B0D163D010B2B5C343401_);
            curl_setopt($ch, CURLOPT_TIMEOUT, 30);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
            $data = curl_exec($ch);
            $_obfuscated_0D09263D0B01122F04143C0D2432332319170F3E133F22_ = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
        } else {
            $_obfuscated_0D162D1F2E3E223B32192B14252C250407271307161201_ = "/^HTTP\\/\\d+\\.\\d+\\s+(\\d+)/";
            $fp = @fsockopen($_obfuscated_0D23311A221D170C3030172B2E393E1902091B0B131911_, 80, $_obfuscated_0D302D1D04121E120901241E0F2F3828113233275C1732_, $_obfuscated_0D303E273E291D245C0E141439152C3D22230E29082A32_, 5);
            if ($fp) {
                $_obfuscated_0D152C1D5B043C15301C0C1C2407283F22013404140C01_ = "\r\n";
                $header = "POST " . $_obfuscated_0D23311A221D170C3030172B2E393E1902091B0B131911_ . $_obfuscated_0D04155B3903042E1205353D301D2C222C1D1716273D11_ . " HTTP/1.0" . $_obfuscated_0D152C1D5B043C15301C0C1C2407283F22013404140C01_;
                $header .= "Host: " . $_obfuscated_0D23311A221D170C3030172B2E393E1902091B0B131911_ . $_obfuscated_0D152C1D5B043C15301C0C1C2407283F22013404140C01_;
                $header .= "Content-type: application/x-www-form-urlencoded" . $_obfuscated_0D152C1D5B043C15301C0C1C2407283F22013404140C01_;
                $header .= "Content-length: " . @strlen($_obfuscated_0D1C3531125B07360A24183B3B0D163D010B2B5C343401_) . $_obfuscated_0D152C1D5B043C15301C0C1C2407283F22013404140C01_;
                $header .= "Connection: close" . $_obfuscated_0D152C1D5B043C15301C0C1C2407283F22013404140C01_ . $_obfuscated_0D152C1D5B043C15301C0C1C2407283F22013404140C01_;
                $header .= $_obfuscated_0D1C3531125B07360A24183B3B0D163D010B2B5C343401_;
                $data = $_obfuscated_0D152C141A5B1B31161F131715103E23110D12273C1E01_ = "";
                @stream_set_timeout($fp, 20);
                @fputs($fp, $header);
                $status = @socket_get_status($fp);
                while (@feof($fp) || !$status) {
                    @fclose($fp);
                }
                $_obfuscated_0D152C141A5B1B31161F131715103E23110D12273C1E01_ = @fgets($fp, 1024);
                $_obfuscated_0D360D263F0816191C242927320F3E193C0E1216093111_ = [];
                if (!$_obfuscated_0D09263D0B01122F04143C0D2432332319170F3E133F22_ && preg_match($_obfuscated_0D162D1F2E3E223B32192B14252C250407271307161201_, trim($_obfuscated_0D152C141A5B1B31161F131715103E23110D12273C1E01_), $_obfuscated_0D360D263F0816191C242927320F3E193C0E1216093111_)) {
                    $_obfuscated_0D09263D0B01122F04143C0D2432332319170F3E133F22_ = empty($_obfuscated_0D360D263F0816191C242927320F3E193C0E1216093111_[1]) ? 0 : $_obfuscated_0D360D263F0816191C242927320F3E193C0E1216093111_[1];
                }
                $data .= $_obfuscated_0D152C141A5B1B31161F131715103E23110D12273C1E01_;
                $status = @socket_get_status($fp);
            }
        }
        if ($_obfuscated_0D09263D0B01122F04143C0D2432332319170F3E133F22_ != 200) {
            $_obfuscated_0D300B5B2D18220F1F243F330329243B29151C2A010C22_ = date("Ymd", mktime(0, 0, 0, date("m"), date("d") - ($_obfuscated_0D0C185C152D3E2B131B3B370806113F5B2B3513011011_ + $_obfuscated_0D1F02302B243715142F3E5C0C3D133E0C1F28341C3211_), date("Y")));
            if ($_obfuscated_0D300B5B2D18220F1F243F330329243B29151C2A010C22_ < $_obfuscated_0D2E25251E0D030A161B39080110010F5B283C26091832_) {
                $results = $_obfuscated_0D175B2E14265C2F3E1F3B083B0B051C011D3910150132_;
            } else {
                $results = [];
                $results["status"] = "Invalid";
                $results["description"] = "Remote Check Failed";
                return $results;
            }
        } else {
            preg_match_all("/<(.*?)>([^<]+)<\\/\\1>/i", $data, $_obfuscated_0D233B2809162D1007333C0E050F30023904032E2A1701_);
            $results = [];
            foreach ($_obfuscated_0D233B2809162D1007333C0E050F30023904032E2A1701_[1] as $k => $_obfuscated_0D32352F3B340B1A33053F09070F010F125C26281C0C01_) {
                $results[$_obfuscated_0D32352F3B340B1A33053F09070F010F125C26281C0C01_] = $_obfuscated_0D233B2809162D1007333C0E050F30023904032E2A1701_[2][$k];
            }
        }
        if (!is_array($results)) {
            exit("Invalid License Server Response");
        }
        if ($results["md5hash"] && $results["md5hash"] != md5($_obfuscated_0D03272B34135C142D192502140C0F143D3309211C0911_ . $_obfuscated_0D3F2118382E1D0D2B281A303B361A331D40270B181101_)) {
            $results["status"] = "Invalid";
            $results["description"] = "MD5 Checksum Verification Failed";
            return $results;
        }
        if ($results["status"] == "Active") {
            $results["checkdate"] = $checkdate;
            $_obfuscated_0D2122230D385B3408233414095C1A35121C0E123C0501_ = json_encode($results);
            $_obfuscated_0D2122230D385B3408233414095C1A35121C0E123C0501_ = base64_encode($_obfuscated_0D2122230D385B3408233414095C1A35121C0E123C0501_);
            $_obfuscated_0D2122230D385B3408233414095C1A35121C0E123C0501_ = md5($checkdate . $_obfuscated_0D03272B34135C142D192502140C0F143D3309211C0911_) . $_obfuscated_0D2122230D385B3408233414095C1A35121C0E123C0501_;
            $_obfuscated_0D2122230D385B3408233414095C1A35121C0E123C0501_ = strrev($_obfuscated_0D2122230D385B3408233414095C1A35121C0E123C0501_);
            $_obfuscated_0D2122230D385B3408233414095C1A35121C0E123C0501_ = $_obfuscated_0D2122230D385B3408233414095C1A35121C0E123C0501_ . md5($_obfuscated_0D2122230D385B3408233414095C1A35121C0E123C0501_ . $_obfuscated_0D03272B34135C142D192502140C0F143D3309211C0911_);
            $_obfuscated_0D2122230D385B3408233414095C1A35121C0E123C0501_ = wordwrap($_obfuscated_0D2122230D385B3408233414095C1A35121C0E123C0501_, 80, "\n", true);
            $results["localkey"] = $_obfuscated_0D2122230D385B3408233414095C1A35121C0E123C0501_;
        }
        $results["remotecheck"] = true;
    }
    unset($postfields);
    unset($data);
    unset($_obfuscated_0D233B2809162D1007333C0E050F30023904032E2A1701_);  
    unset($_obfuscated_0D23311A221D170C3030172B2E393E1902091B0B131911_);
    unset($_obfuscated_0D03272B34135C142D192502140C0F143D3309211C0911_);
    unset($checkdate);
    unset($_obfuscated_0D2D1128091B13143D2524321A2738152F1F362E310501_);
    unset($_obfuscated_0D0C185C152D3E2B131B3B370806113F5B2B3513011011_);
    unset($_obfuscated_0D1F02302B243715142F3E5C0C3D133E0C1F28341C3211_);
    unset($_obfuscated_0D263D30241B3625131906340C1F1B31280E1A34063022_);
    return $results;
}

//$licensekey = "infinitq379b3fe82f";
//
//$localkey = '9tjIxIzNwgDMwIjI6gjOztjIlRXYkt2Ylh2YioTO6M3OicmbpNnblNWasx1cyVmdyV2ccNXZsVHZv1GX
//zNWbodHXlNmc192czNWbodHXzN2bkRHacBFUNFEWcNHduVWb1N2bExFd0FWTcNnclNXVcpzQioDM4ozc
//7ISey9GdjVmcpRGZpxWY2JiO0EjOztjIx4CMuAjL3ITMioTO6M3OiAXaklGbhZnI6cjOztjI0N3boxWY
//j9Gbuc3d3xCdz9GasF2YvxmI6MjM6M3Oi4Wah12bkRWasFmdioTMxozc7ISeshGdu9WTiozN6M3OiUGb
//jl3Yn5WasxWaiJiOyEjOztjI3ATL4ATL4ADMyIiOwEjOztjIlRXYkVWdkRHel5mI6ETM6M3OicDMtcDM
//tgDMwIjI6ATM6M3OiUGdhR2ZlJnI6cjOztjIlNXYlxEI5xGa052bNByUD1ESXJiO5EjOztjIl1WYuR3Y
//1R2byBnI6ETM6M3OicjI6EjOztjIklGdjVHZvJHcioTO6M3Oi02bj5ycj1Ga3BEd0FWbioDNxozc7ICb
//pFWblJiO1ozc7IyUD1ESXBCd0FWTioDMxozc7ISZtFmbkVmclR3cpdWZyJiO0EjOztjIlZXa0NWQiojN
//6M3OiMXd0FGdzJiO2ozc7pjMxoTY8baca0885830a33725148e94e693f3f073294c0558d38e31f844
//c5e399e3c16a';
//
//$results = _obfuscated_0D150F270D293B1F06335B3D2326142A29141713125B11_($licensekey, $localkey);
//
//echo var_dump($results);
//
//array(3) { ["status"]=> string(7) "Invalid" ["message"]=> string(14) "Domain Invalid" ["remotecheck"]=> bool(true) }
?>