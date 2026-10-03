<?php
include "header.php";
include "config.php";
?>

<style>
    * {
        box-sizing: border-box;
    }

    body {
        overflow-x: hidden;
        margin: 0;
        padding: 0;
    }

    .topmoviestext2 {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 80vh;
        padding: 20px;
        width: 100%;
    }

    .slideshow-container {
        width: 100%;
        max-width: 800px;
        background-color: #1F2C3D;
        border-radius: 10px;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
        overflow: hidden;
    }

    .mySlides {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 40px;
        gap: 20px;
    }

    .notification-text-sec {
        flex: 1;
    }

    .notification-heading {
        font-size: 36px;
        color: #e50914;
        margin-top: 0;
        margin-bottom: 10px;
        font-weight: bold;
    }

    .notification-subheading-sec p {
        font-size: 18px;
        color: #ccc;
        margin: 10px 0;
    }

    .notification-subheading-sec a {
        display: inline-block;
        background-color: #e50914;
        color: white;
        padding: 12px 25px;
        text-decoration: none;
        border-radius: 5px;
        font-weight: bold;
        transition: background-color 0.3s ease;
        margin-top: 15px;
    }

    .notification-subheading-sec a:hover {
        background-color: #f40612;
    }

    .notification-image {
        flex-shrink: 0;
    }

    .notification-image img {
        max-width: 150px;
        height: auto;
        display: block;
    }

    @media (max-width: 768px) {
        .topmoviestext2 {
            padding: 15px;
            align-items: flex-start;
            margin-top: 50px;
        }

        .mySlides {
            flex-direction: column-reverse;
            text-align: center;
            padding: 30px 20px;
        }

        .notification-heading {
            font-size: 28px;
        }

        .notification-subheading-sec p {
            font-size: 16px;
        }

        .notification-image img {
            max-width: 120px;
            margin: 0 auto 20px auto;
        }
    }
</style>

<div class="topmoviestext2">
    <div class="slideshow-container">
        <div class="mySlides custfade">
            <div class="notification-text-sec">
                <h4 class="notification-heading">Account Expired</h4>
                <input type="hidden" value="Announcement" id="notificationType">
                <input type="hidden" value="" id="notificationReferenceId">
                <div class="notification-subheading-sec">
                    <p>Please Renew Your Account</p>
                </div>
                <div class="notification-subheading-sec">
                    <p><a href="<?php echo $get_dir; ?>/logout">Go Back To Login</a></p>
                </div>
            </div>
            <div class="notification-image">
                <img src="http://ltq.lttelevision.com/assets/uploads/files/c8fbc-red-attention-sign-png-no-background.png" alt="Attention">
            </div>
        </div>
    </div>
</div>
